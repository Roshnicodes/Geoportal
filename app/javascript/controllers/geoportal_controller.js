import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "map", "loadingPanel", "statusText", "mapCaption",
    "globe", "globeCanvas", "viewButton",
    "adminDropdown", "adminSummary",
    "projectSelect", "verticalSelect", "activitySelect", "blockSelect",
    "searchInput", "interventionToggle",
    "visibleCount", "activeBlocks",
    "blocksMetric", "villagesMetric", "interventionMetric", "coverageMetric",
    "legend", "detailsPanel", "navLink"
  ]

  static values = { dataBase: String }

  connect() {
    this.blockColors = new Map()
    this.coverageVillages = new Set()
    this.visiblePoiIndexes = new Set()
    this.palette = ["#0f9d76", "#e08a1e", "#7d5fb2", "#c75b44", "#0b7d8c", "#5f8f2f", "#3c72b8"]
    this.layerState = { state: false, district: true, block: true, gp: false, village: true, coverage: true }
    this.viewMode = "map"
    this.globeRadius = 100
    this.globeRegionScale = 12
    this.globeAnimationId = null
    this.globeResizeHandler = () => this.resizeGlobe()

    if (!window.L) {
      this.setStatus("Map library could not load")
      this.loadingPanelTarget.classList.add("is-hidden")
      return
    }

    this.initMap()
    this.setInitialView()
    this.trackNav()
    this.loadData()
  }

  initMap() {
    const L = window.L
    this.map = L.map(this.mapTarget, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 8,
      maxZoom: 18,
      preferCanvas: true
    }).setView([21.75, 74.9], 10)

    this.map.createPane("districtPane")
    this.map.createPane("villagePane")
    this.map.createPane("coveragePane")
    this.map.createPane("blockPane")
    this.map.createPane("interventionPane")
    this.map.getPane("districtPane").style.zIndex = 360
    this.map.getPane("villagePane").style.zIndex = 380
    this.map.getPane("coveragePane").style.zIndex = 395
    this.map.getPane("blockPane").style.zIndex = 410
    this.map.getPane("interventionPane").style.zIndex = 430

    const lightBase = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxNativeZoom: 16, maxZoom: 18, attribution: "Tiles &copy; Esri"
      })
    const lightLabels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
        maxNativeZoom: 16, maxZoom: 18, attribution: "Labels &copy; Esri"
      })
    const cleanMap = L.layerGroup([lightBase, lightLabels])
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    })
    const humanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    })
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Tiles &copy; Esri"
      })

    cleanMap.addTo(this.map)
    L.control.layers(
      { "Clean Map": cleanMap, "Street": street, "Humanitarian": humanitarian, "Satellite": satellite },
      {},
      { position: "bottomright", collapsed: true }
    ).addTo(this.map)
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(this.map)

    // Layer groups
    this.districtLayer = L.layerGroup()
    this.blockLayer = L.layerGroup()
    this.villageLayer = L.layerGroup()
    this.coverageLayer = L.layerGroup()
    this.interventionLayer = L.layerGroup()
  }

  async loadData() {
    try {
      const base = this.dataBaseValue || "/data/barwani"
      const [manifest, blocks, villages, pois] = await Promise.all([
        this.fetchJson(`${base}/manifest.json`),
        this.fetchJson(`${base}/blocks.geojson`),
        this.fetchJson(`${base}/villages.geojson`),
        this.fetchJson(`${base}/poi_wrd_interventions.geojson`)
      ])

      this.manifest = manifest
      this.blocks = blocks.features
      this.villages = villages.features
      this.pois = pois.features
      this.bbox = manifest.bbox

      this.pois.forEach((f) => {
        const key = this.coverageKey(f.properties.block, f.properties.village)
        if (key) this.coverageVillages.add(key)
      })

      this.assignBlockColors()
      this.buildLayers()
      this.populateControls()
      this.renderLegend()
      this.updateMetrics()
      this.applyBounds()
      this.syncAdminLayers()
      this.filterChanged()
      if (this.viewMode === "globe") this.initGlobe()

      this.loadingPanelTarget.classList.add("is-hidden")
    } catch (error) {
      this.loadingPanelTarget.classList.add("is-hidden")
      this.setStatus(`Data load failed: ${error.message}`)
    }
  }

  async fetchJson(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} returned ${res.status}`)
    return res.json()
  }

  assignBlockColors() {
    this.blocks
      .map((f) => f.properties.name)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name, i) => this.blockColors.set(name, this.palette[i % this.palette.length]))
  }

  buildLayers() {
    const L = window.L

    // District layer uses the block geometries as a single visual outline.
    L.geoJSON({ type: "FeatureCollection", features: this.blocks }, {
      pane: "districtPane",
      style: { color: "#08251f", weight: 4, fill: true, fillColor: "#0f9d76", fillOpacity: 0.04, dashArray: null },
      interactive: false
    }).addTo(this.districtLayer)

    // Villages
    this.villageGeo = L.geoJSON({ type: "FeatureCollection", features: this.villages }, {
      pane: "villagePane",
      style: (f) => ({
        color: this.blockColors.get(f.properties.block) || "#0f9d76",
        weight: 0.65, fillColor: this.blockColors.get(f.properties.block) || "#0f9d76", fillOpacity: 0.16
      }),
      onEachFeature: (f, layer) => {
        layer.on("click", () => this.showVillage(f))
        layer._props = f.properties
      }
    })
    this.villageGeo.addTo(this.villageLayer)

    // ASA coverage villages (subset with interventions)
    const coverageFeatures = this.villages.filter((f) => this.coverageVillages.has(this.coverageKey(f.properties.block, f.properties.name)))
    L.geoJSON({ type: "FeatureCollection", features: coverageFeatures }, {
      pane: "coveragePane",
      style: { color: "#f0a33a", weight: 1.8, fillColor: "#f0a33a", fillOpacity: 0.28 },
      onEachFeature: (f, layer) => layer.on("click", () => this.showVillage(f, true))
    }).addTo(this.coverageLayer)

    // Blocks
    L.geoJSON({ type: "FeatureCollection", features: this.blocks }, {
      pane: "blockPane",
      style: (f) => ({
        color: this.blockColors.get(f.properties.name), weight: 2.6,
        fillColor: this.blockColors.get(f.properties.name), fillOpacity: 0.06
      }),
      onEachFeature: (f, layer) => {
        layer.on("click", () => this.showBlock(f))
        layer.bindTooltip(f.properties.name, { permanent: true, direction: "center", className: "block-tip" })
      }
    }).addTo(this.blockLayer)

    // Interventions
    this.interventionMarkers = []
    this.pois.forEach((f, index) => {
      const [lon, lat] = f.geometry.coordinates
      const isDam = f.properties.icon === "dam"
      const marker = L.circleMarker([lat, lon], {
        pane: "interventionPane",
        radius: 6, color: "#fff", weight: 1.5,
        fillColor: isDam ? "#c75b44" : "#0b7d8c", fillOpacity: 0.95
      })
      marker._props = f.properties
      marker._poiIndex = index
      marker.on("click", () => this.showIntervention(f))
      this.interventionMarkers.push(marker)
    })
  }

  populateControls() {
    const projects = this.manifest.projects || {}
    const projectNames = Object.keys(projects).length ? Object.keys(projects) : [...new Set(this.pois.map((f) => f.properties.project || f.properties.theme).filter(Boolean))]
    projectNames.sort().forEach((p) => this.addOption(this.projectSelectTarget, p, `${p} (${projects[p] || this.manifest.counts.interventions || this.manifest.counts.pois})`))

    const verticals = this.manifest.verticals || []
    verticals.forEach((v) => this.addOption(this.verticalSelectTarget, v.name, `${v.label} (${v.poi_count})`))

    // Intervention types
    const counts = this.manifest.activity_counts || {}
    Object.keys(counts).sort().forEach((a) => this.addOption(this.activitySelectTarget, a, `${a} (${counts[a]})`))

    // Blocks
    this.blocks.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b))
      .forEach((b) => this.addOption(this.blockSelectTarget, b, b))
  }

  addOption(select, value, label) {
    const opt = document.createElement("option")
    opt.value = value
    opt.textContent = label
    select.append(opt)
  }

  renderLegend() {
    const c = this.manifest.counts
    const a = this.manifest.activity_counts || {}
    const items = [
      ["district", "District", "1 district"],
      ["block", "Block Boundary", `${c.blocks} blocks`],
      ["village", "Village Boundary", `${c.villages} villages`],
      ["coverage", "ASA Coverage Village", `${this.coverageVillages.size} villages`],
      ["well", "Dugwell", `${a.Dugwell || 0}`],
      ["dam", "Stop Dam", `${a["Stop Dam"] || 0}`]
    ]
    this.legendTarget.innerHTML = ""
    items.forEach(([cls, label, meta]) => {
      const row = document.createElement("div")
      row.className = "legend-item"
      row.innerHTML = `<i class="sw sw-${cls}"></i><div><strong>${label}</strong><span>${meta}</span></div>`
      this.legendTarget.append(row)
    })
  }

  // ---- Admin boundary checkboxes ----
  adminToggle(event) {
    const input = event.target
    const layer = input.dataset.layer
    if (layer) this.layerState[layer] = input.checked
    this.syncAdminLayers()
    this.updateAdminSummary()
    this.filterChanged()
    this.syncGlobeLayers()
  }

  syncAdminLayers() {
    const map = {
      district: this.districtLayer,
      block: this.blockLayer,
      village: this.villageLayer,
      coverage: this.coverageLayer
    }
    Object.entries(map).forEach(([key, group]) => {
      if (this.layerState[key]) group.addTo(this.map)
      else this.map.removeLayer(group)
    })
    this.updateAdminSummary()
  }

  updateAdminSummary() {
    if (!this.hasAdminSummaryTarget) return
    const labels = { state: "State", district: "District", block: "Block", gp: "GP", village: "Village", coverage: "ASA Coverage" }
    const active = Object.keys(labels).filter((k) => this.layerState[k]).map((k) => labels[k])
    this.adminSummaryTarget.textContent = active.length ? active.join(", ") : "None selected"
  }

  // ---- Filtering interventions ----
  filterChanged() {
    if (!this.manifest) return
    const project = this.projectSelectTarget.value
    const vertical = this.verticalSelectTarget.value
    const activity = this.activitySelectTarget.value
    const block = this.blockSelectTarget.value
    const query = this.norm(this.searchInputTarget.value)
    const showInterventions = this.interventionToggleTarget.checked

    let visible = 0
    this.visiblePoiIndexes.clear()
    this.interventionMarkers.forEach((marker) => {
      const p = marker._props
      const ok = showInterventions &&
        (project === "all" || (p.project || p.theme) === project) &&
        (vertical === "all" || p.vertical === vertical) &&
        (activity === "all" || p.activity === activity) &&
        (block === "all" || p.block === block) &&
        (!query || this.searchText(p, ["name", "activity", "block", "village", "lgd_code"]).includes(query))
      if (ok) {
        marker.addTo(this.interventionLayer)
        visible += 1
        this.visiblePoiIndexes.add(marker._poiIndex)
      } else {
        this.interventionLayer.removeLayer(marker)
      }
    })

    if (showInterventions) this.interventionLayer.addTo(this.map)
    else this.map.removeLayer(this.interventionLayer)

    this.visibleCountTarget.textContent = visible.toLocaleString("en-IN")
    this.activeBlocksTarget.textContent = block === "all" ? this.blocks.length : 1
    this.mapCaptionTarget.textContent = this.caption(block, project, activity)
    this.setStatus(`${visible.toLocaleString("en-IN")} interventions visible`)
    this.updateGlobeInterventions()
  }

  blockChanged() {
    this.filterChanged()
    const block = this.blockSelectTarget.value
    if (block === "all") {
      this.applyBounds()
      if (this.viewMode === "globe") this.resetGlobeView()
      return
    }
    const feature = this.blocks.find((f) => f.properties.name === block)
    if (feature?.properties?.bbox) {
      this.fitBbox(feature.properties.bbox)
      if (this.viewMode === "globe") this.focusGlobeOnBbox(feature.properties.bbox)
    }
  }

  // ---- Feature detail panels ----
  showBlock(f) {
    this.blockSelectTarget.value = f.properties.name
    this.blockChanged()
    this.renderDetails(f.properties.name, "Block", [
      ["District", f.properties.district],
      ["Interventions", this.manifest.poi_block_counts[f.properties.name] || 0],
      ["Villages", this.manifest.village_block_counts[f.properties.name] || 0]
    ])
  }

  showVillage(f, coverage = false) {
    this.renderDetails(f.properties.name, coverage ? "ASA Coverage Village" : "Village", [
      ["Block", f.properties.block],
      ["District", f.properties.district],
      ["LGD Code", f.properties.lgd_code]
    ])
  }

  showIntervention(f) {
    this.renderDetails(f.properties.name, "Intervention", [
      ["Type", f.properties.activity],
      ["Vertical", f.properties.vertical],
      ["Project", f.properties.project || f.properties.theme],
      ["Block", f.properties.block],
      ["Village", f.properties.village],
      ["LGD Code", f.properties.lgd_code]
    ])
  }

  renderDetails(title, kind, rows) {
    const el = this.detailsPanelTarget
    el.innerHTML = ""
    const kicker = document.createElement("p")
    kicker.className = "card-label"
    kicker.textContent = kind
    const h = document.createElement("h3")
    h.className = "details-title"
    h.textContent = title
    const dl = document.createElement("dl")
    rows.forEach(([term, val]) => {
      const div = document.createElement("div")
      const dt = document.createElement("dt")
      const dd = document.createElement("dd")
      dt.textContent = term
      dd.textContent = val === null || val === undefined || val === "" ? "Not mapped" : val
      div.append(dt, dd)
      dl.append(div)
    })
    el.append(kicker, h, dl)
  }

  updateMetrics() {
    this.blocksMetricTarget.textContent = this.manifest.counts.blocks.toLocaleString("en-IN")
    this.villagesMetricTarget.textContent = this.manifest.counts.villages.toLocaleString("en-IN")
    const interventions = this.manifest.counts.interventions || this.manifest.counts.pois
    this.interventionMetricTarget.textContent = interventions.toLocaleString("en-IN")
    this.coverageMetricTarget.textContent = this.coverageVillages.size.toLocaleString("en-IN")
  }

  // ---- 2D map / 3D globe switch ----
  setInitialView() {
    const params = new URLSearchParams(window.location.search)
    if (params.get("view") === "globe") this.setViewMode("globe")
  }

  switchView(event) {
    this.setViewMode(event.currentTarget.dataset.view || "map")
  }

  setViewMode(mode) {
    this.viewMode = mode === "globe" ? "globe" : "map"
    this.mapTarget.classList.toggle("is-hidden", this.viewMode === "globe")
    this.globeTarget.classList.toggle("is-hidden", this.viewMode !== "globe")
    this.viewButtonTargets.forEach((button) => {
      const active = button.dataset.view === this.viewMode
      button.classList.toggle("is-active", active)
      if (button.tagName === "BUTTON") {
        button.setAttribute("aria-selected", active ? "true" : "false")
      } else if (active) {
        button.setAttribute("aria-current", "page")
      } else {
        button.removeAttribute("aria-current")
      }
    })

    if (this.viewMode === "globe") {
      this.setStatus("Preparing 3D globe")
      this.globeCustomZoom = false
      this.initGlobe()
      setTimeout(() => this.resizeGlobe(), 80)
    } else {
      this.stopGlobe()
      this.filterChanged()
      setTimeout(() => this.map.invalidateSize(), 80)
    }
  }

  async initGlobe() {
    if (this.globeReady) {
      this.resizeGlobe()
      this.startGlobe()
      this.syncGlobeLayers()
      this.updateGlobeInterventions()
      return
    }
    if (this.globeLoading || !this.manifest || !this.hasGlobeCanvasTarget) return

    this.globeLoading = true
    try {
      this.THREE ||= await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js")
      this.setupGlobeScene()
      this.buildGlobeLayers()
      this.syncGlobeLayers()
      this.updateGlobeInterventions()
      this.resizeGlobe()
      window.addEventListener("resize", this.globeResizeHandler)
      this.globeReady = true
      this.startGlobe()
      this.setStatus(`${this.visiblePoiIndexes.size.toLocaleString("en-IN")} interventions on globe`)
    } catch (error) {
      this.setStatus(`Globe load failed: ${error.message}`)
    } finally {
      this.globeLoading = false
    }
  }

  setupGlobeScene() {
    const THREE = this.THREE
    this.globeScene = new THREE.Scene()
    this.globeCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 900)
    this.globeCamera.position.set(0, 0, this.defaultGlobeDistance())

    this.globeRenderer = new THREE.WebGLRenderer({
      canvas: this.globeCanvasTarget,
      antialias: true,
      alpha: true
    })
    this.globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.globeRenderer.setClearColor(0x041420, 0)

    this.globeScene.add(new THREE.AmbientLight(0xb9dcff, 1.15))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(140, 160, 260)
    this.globeScene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x5ff0c8, 0.75)
    rimLight.position.set(-180, -80, -120)
    this.globeScene.add(rimLight)

    this.globeRoot = new THREE.Group()
    this.globeScene.add(this.globeRoot)

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(this.globeRadius, 128, 96),
      new THREE.MeshPhongMaterial({
        color: 0x0b6f82,
        emissive: 0x021a24,
        specular: 0x88d8d1,
        shininess: 22
      })
    )
    this.globeRoot.add(earth)

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.globeRadius + 4, 96, 64),
      new THREE.MeshBasicMaterial({
        color: 0x8df7ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide
      })
    )
    this.globeRoot.add(atmosphere)
    this.addGlobeGrid()
    this.resetGlobeView()
    this.attachGlobeEvents()
  }

  buildGlobeLayers() {
    const THREE = this.THREE
    this.globeLayerGroups = {
      district: new THREE.Group(),
      block: new THREE.Group(),
      village: new THREE.Group(),
      coverage: new THREE.Group()
    }
    Object.values(this.globeLayerGroups).forEach((group) => this.globeRoot.add(group))

    const districtMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    const villageMaterial = new THREE.LineBasicMaterial({ color: 0x99e7ff, transparent: true, opacity: 0.38 })
    const coverageMaterial = new THREE.LineBasicMaterial({ color: 0xffc84d, transparent: true, opacity: 0.92 })

    this.addFeatureLines(this.blocks, this.globeLayerGroups.district, () => districtMaterial, this.globeRadius + 1.6)
    this.addFeatureLines(this.villages, this.globeLayerGroups.village, () => villageMaterial, this.globeRadius + 2)
    this.addFeatureLines(this.blocks, this.globeLayerGroups.block, (feature) => {
      return new THREE.LineBasicMaterial({
        color: this.hexToNumber(this.blockColors.get(feature.properties.name) || "#0f9d76"),
        transparent: true,
        opacity: 0.95
      })
    }, this.globeRadius + 2.5)

    const coverageFeatures = this.villages.filter((feature) => {
      return this.coverageVillages.has(this.coverageKey(feature.properties.block, feature.properties.name))
    })
    this.addFeatureLines(coverageFeatures, this.globeLayerGroups.coverage, () => coverageMaterial, this.globeRadius + 3)

    this.globeInterventionGroup = new THREE.Group()
    this.globeRoot.add(this.globeInterventionGroup)
    this.globeInterventionMeshes = []
    const wellGeometry = new THREE.SphereGeometry(1.15, 14, 10)
    const damGeometry = new THREE.OctahedronGeometry(1.45, 0)
    const wellMaterial = new THREE.MeshBasicMaterial({ color: 0x13d9d0 })
    const damMaterial = new THREE.MeshBasicMaterial({ color: 0xff744f })

    this.pois.forEach((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates
      const isDam = feature.properties.icon === "dam"
      const marker = new THREE.Mesh(isDam ? damGeometry : wellGeometry, isDam ? damMaterial : wellMaterial)
      marker.position.copy(this.latLonToVector(lat, lon, this.globeRadius + 5, true))
      marker.userData = { feature, index }
      marker.renderOrder = 10
      marker.visible = this.visiblePoiIndexes.has(index)
      this.globeInterventionMeshes.push(marker)
      this.globeInterventionGroup.add(marker)
    })
  }

  addGlobeGrid() {
    const THREE = this.THREE
    const material = new THREE.LineBasicMaterial({ color: 0xd7fbff, transparent: true, opacity: 0.16 })
    for (let lat = -60; lat <= 60; lat += 30) {
      const ring = []
      for (let lon = -180; lon <= 180; lon += 3) ring.push([lon, lat])
      this.globeRoot.add(this.createGlobeLine(ring, material, this.globeRadius + 0.6, false))
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const line = []
      for (let lat = -84; lat <= 84; lat += 3) line.push([lon, lat])
      this.globeRoot.add(this.createGlobeLine(line, material, this.globeRadius + 0.6, false))
    }
  }

  addFeatureLines(features, group, materialForFeature, radius) {
    features.forEach((feature) => {
      const material = materialForFeature(feature)
      this.geometryRings(feature.geometry).forEach((ring) => {
        const line = this.createGlobeLine(ring, material, radius, true)
        if (line) group.add(line)
      })
    })
  }

  createGlobeLine(coords, material, radius, magnify) {
    const THREE = this.THREE
    const points = coords
      .map(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) ? this.latLonToVector(lat, lon, radius, magnify) : null)
      .filter(Boolean)
    if (points.length < 2) return null
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
  }

  syncGlobeLayers() {
    if (!this.globeLayerGroups) return
    Object.entries(this.globeLayerGroups).forEach(([key, group]) => {
      group.visible = Boolean(this.layerState[key])
    })
    if (this.globeInterventionGroup) this.globeInterventionGroup.visible = this.interventionToggleTarget.checked
    this.renderGlobe()
  }

  updateGlobeInterventions() {
    if (!this.globeInterventionMeshes) return
    const showInterventions = this.interventionToggleTarget.checked
    this.globeInterventionMeshes.forEach((marker) => {
      marker.visible = showInterventions && this.visiblePoiIndexes.has(marker.userData.index)
    })
    if (this.globeInterventionGroup) this.globeInterventionGroup.visible = showInterventions
    this.renderGlobe()
  }

  startGlobe() {
    if (!this.globeRenderer || this.globeAnimationId || this.viewMode !== "globe") return
    const animate = () => {
      if (this.viewMode !== "globe") { this.globeAnimationId = null; return }
      if (this.globeRoot && !this.globeDragging) this.globeRoot.rotation.y += 0.00035
      this.globeRenderer.render(this.globeScene, this.globeCamera)
      this.globeAnimationId = window.requestAnimationFrame(animate)
    }
    this.globeAnimationId = window.requestAnimationFrame(animate)
  }

  stopGlobe() {
    if (!this.globeAnimationId) return
    window.cancelAnimationFrame(this.globeAnimationId)
    this.globeAnimationId = null
  }

  renderGlobe() {
    if (!this.globeRenderer || !this.globeScene || !this.globeCamera) return
    this.globeRenderer.render(this.globeScene, this.globeCamera)
  }

  resizeGlobe() {
    if (!this.globeRenderer || !this.hasGlobeTarget) return
    const rect = this.globeTarget.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width || this.globeCanvasTarget.clientWidth))
    const height = Math.max(1, Math.floor(rect.height || this.globeCanvasTarget.clientHeight))
    this.globeRenderer.setSize(width, height, false)
    if (!this.globeCustomZoom) this.globeCamera.position.z = this.defaultGlobeDistance(width)
    this.globeCamera.aspect = width / height
    this.globeCamera.updateProjectionMatrix()
    this.renderGlobe()
  }

  attachGlobeEvents() {
    if (this.globeEventsAttached) return
    const canvas = this.globeCanvasTarget
    this.globePointerState = { down: false, moved: false, x: 0, y: 0 }
    this.globePointer = new this.THREE.Vector2()
    this.globeRaycaster = new this.THREE.Raycaster()
    this.globeEvents = {
      pointerdown: (event) => this.globePointerDown(event),
      pointermove: (event) => this.globePointerMove(event),
      pointerup: (event) => this.globePointerUp(event),
      pointerleave: () => this.globePointerLeave(),
      wheel: (event) => this.globeWheel(event)
    }
    Object.entries(this.globeEvents).forEach(([name, handler]) => canvas.addEventListener(name, handler, { passive: false }))
    this.globeEventsAttached = true
  }

  detachGlobeEvents() {
    if (!this.globeEventsAttached || !this.globeEvents) return
    Object.entries(this.globeEvents).forEach(([name, handler]) => this.globeCanvasTarget.removeEventListener(name, handler))
    this.globeEventsAttached = false
  }

  globePointerDown(event) {
    this.globePointerState = { down: true, moved: false, x: event.clientX, y: event.clientY }
    this.globeDragging = true
    this.globeTarget.classList.add("is-dragging")
    this.globeCanvasTarget.setPointerCapture?.(event.pointerId)
  }

  globePointerMove(event) {
    if (!this.globePointerState?.down || !this.globeRoot) return
    const dx = event.clientX - this.globePointerState.x
    const dy = event.clientY - this.globePointerState.y
    if (Math.abs(dx) + Math.abs(dy) > 2) this.globePointerState.moved = true
    this.globeRoot.rotation.y += dx * 0.006
    this.globeRoot.rotation.x = Math.max(-1.2, Math.min(1.2, this.globeRoot.rotation.x + dy * 0.004))
    this.globePointerState.x = event.clientX
    this.globePointerState.y = event.clientY
    this.renderGlobe()
  }

  globePointerUp(event) {
    const moved = this.globePointerState?.moved
    this.globePointerState.down = false
    this.globeDragging = false
    this.globeTarget.classList.remove("is-dragging")
    this.globeCanvasTarget.releasePointerCapture?.(event.pointerId)
    if (!moved) this.pickGlobeFeature(event)
  }

  globePointerLeave() {
    if (!this.globePointerState) return
    this.globePointerState.down = false
    this.globeDragging = false
    this.globeTarget.classList.remove("is-dragging")
  }

  globeWheel(event) {
    event.preventDefault()
    this.zoomGlobe(event.deltaY > 0 ? 18 : -18)
  }

  pickGlobeFeature(event) {
    if (!this.globeRaycaster || !this.globeInterventionMeshes) return
    const rect = this.globeCanvasTarget.getBoundingClientRect()
    this.globePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.globePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.globeRaycaster.setFromCamera(this.globePointer, this.globeCamera)
    const hits = this.globeRaycaster.intersectObjects(this.globeInterventionMeshes.filter((marker) => marker.visible), false)
    if (hits[0]?.object?.userData?.feature) this.showIntervention(hits[0].object.userData.feature)
  }

  zoomGlobe(delta) {
    if (!this.globeCamera) return
    this.globeCustomZoom = true
    this.globeCamera.position.z = Math.max(165, Math.min(380, this.globeCamera.position.z + delta))
    this.renderGlobe()
  }

  resetGlobeView() {
    if (!this.globeCamera || !this.bbox) return
    this.globeCustomZoom = false
    this.globeCamera.position.z = this.defaultGlobeDistance()
    const center = this.globeCenter()
    this.focusGlobeOnLatLon(center.lat, center.lon)
  }

  focusGlobeOnBbox(bbox) {
    if (!bbox) return
    this.focusGlobeOnLatLon((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2)
  }

  focusGlobeOnLatLon(lat, lon) {
    if (!this.globeRoot || !this.THREE) return
    const source = this.latLonToVector(lat, lon, 1, true).normalize()
    const target = new this.THREE.Vector3(0, 0, 1)
    this.globeRoot.quaternion.setFromUnitVectors(source, target)
    this.renderGlobe()
  }

  defaultGlobeDistance(width = null) {
    const measuredWidth = width || (this.hasGlobeTarget ? this.globeTarget.getBoundingClientRect().width : window.innerWidth)
    return measuredWidth < 720 ? 360 : 265
  }

  // ---- Map controls ----
  zoomIn() {
    if (this.viewMode === "globe") { this.zoomGlobe(-24); return }
    this.map.zoomIn()
  }

  zoomOut() {
    if (this.viewMode === "globe") { this.zoomGlobe(24); return }
    this.map.zoomOut()
  }

  resetView() {
    this.blockSelectTarget.value = "all"
    this.applyBounds()
    this.filterChanged()
    if (this.viewMode === "globe") this.resetGlobeView()
  }

  applyBounds() {
    if (!this.bbox) return
    this.map.fitBounds([[this.bbox[1], this.bbox[0]], [this.bbox[3], this.bbox[2]]], { padding: [24, 24] })
    this.map.setMaxBounds([[this.bbox[1] - 0.18, this.bbox[0] - 0.18], [this.bbox[3] + 0.18, this.bbox[2] + 0.18]])
  }

  fitBbox(b) {
    this.map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] })
  }

  // ---- Nav active state ----
  trackNav() {
    const sections = ["home", "map", "data"]
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const id = entry.target.id
        this.navLinkTargets.forEach((link) => {
          const isMapSection = id === "map"
          const active = link.getAttribute("href") === `#${id}` && (!isMapSection || this.viewMode === "map")
          link.classList.toggle("is-active", active)
        })
        if (id === "map" && this.map && this.viewMode === "map") setTimeout(() => this.map.invalidateSize(), 120)
        if (id === "map" && this.viewMode === "globe") setTimeout(() => this.resizeGlobe(), 120)
      })
    }, { threshold: 0.5 })
    sections.forEach((id) => {
      const el = document.getElementById(id)
      if (el) this.observer.observe(el)
    })
  }

  // ---- helpers ----
  globeCenter() {
    const bbox = this.bbox || [74.4308, 21.3681, 75.6309, 22.1341]
    return { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 }
  }

  latLonToVector(lat, lon, radius, magnify = false) {
    if (magnify) {
      const center = this.globeCenter()
      lat = Math.max(-85, Math.min(85, center.lat + ((lat - center.lat) * this.globeRegionScale)))
      lon = center.lon + ((lon - center.lon) * this.globeRegionScale)
    }

    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lon + 180) * (Math.PI / 180)
    return new this.THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    )
  }

  geometryRings(geometry) {
    if (!geometry) return []
    if (geometry.type === "Polygon") return geometry.coordinates
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flat()
    return []
  }

  hexToNumber(hex) {
    return Number.parseInt(String(hex || "#0f9d76").replace("#", ""), 16) || 0x0f9d76
  }

  caption(block, project, activity) {
    const parts = [block === "all" ? "Barwani District" : block]
    if (project !== "all") parts.push(project)
    if (activity !== "all") parts.push(activity)
    return parts.join(" / ")
  }

  searchText(props, keys) {
    return this.norm(keys.map((k) => props[k]).join(" "))
  }

  norm(v) {
    return String(v || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim()
  }

  coverageKey(block, village) {
    if (!block || !village) return null
    return `${this.norm(block)}|${this.norm(village)}`
  }

  setStatus(msg) {
    if (this.hasStatusTextTarget) this.statusTextTarget.textContent = msg
  }

  disconnect() {
    if (this.observer) this.observer.disconnect()
    this.stopGlobe()
    window.removeEventListener("resize", this.globeResizeHandler)
    this.detachGlobeEvents()
    if (this.globeRenderer) this.globeRenderer.dispose()
    if (this.map) this.map.remove()
  }
}
