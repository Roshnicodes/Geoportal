import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "map", "loadingPanel", "statusText", "mapCaption",
    "districtLabel", "districtEyebrow", "loadingDatasetText",
    "globe", "globeCanvas", "projectionStatus", "viewButton",
    "adminDropdown", "adminSummary", "adminTree",
    "projectList", "projectSummary", "projectCheck",
    "fyList", "fySummary", "fyCheck",
    "verticalList", "verticalSummary", "verticalCheck",
    "activityList", "activitySummary", "activityCheck",
    "blockCheck", "villageFilterCheck",
    "searchInput", "interventionToggle",
    "visibleCount", "activeBlocks",
    "blocksMetric", "villagesMetric", "interventionMetric", "coverageMetric",
    "legend", "legendPanel", "legendButton", "detailsPanel", "navLink",
    "workspace", "toolPanel", "toolPanelTitle", "toolPanelCaption", "toolRailButton",
    "languageButton", "lgdInput", "lgdStatus", "bufferDistanceInput", "bufferStatus",
    "comparisonPrimary", "comparisonSecondary", "comparisonResult",
    "routeStatus", "routeList", "baseMapMenu", "coordinateStatus",
    "mapSearchInput", "searchModeButton", "printHeader"
  ]

  static values = { dataBase: String, defaultState: String }

  connect() {
    this.blockColors = new Map()
    this.coverageVillages = new Set()
    this.visiblePoiIndexes = new Set()
    this.visibleAgribusinessIndexes = new Set()
    this.visiblePlantationIndexes = new Set()
    this.explicitEmptyFilters = new Set()
    this.mapItemsVisible = false
    this.palette = ["#0f9d76", "#e08a1e", "#7d5fb2", "#c75b44", "#0b7d8c", "#5f8f2f", "#3c72b8"]
    this.layerState = { state: false, district: true, block: false, gp: false, village: false, villageLabels: false, coverage: false }
    this.manualAdminLayers = new Set()
    this.viewMode = "map"
    this.globeRadius = 100
    this.globeRegionScale = 12
    this.globeAnimationId = null
    this.globeResizeHandler = () => this.resizeGlobe()
    this.detailFetchToken = 0
    this.activeTool = "layers"
    this.language = "en"
    this.searchMode = "text"
    this.routePoints = []
    this.measurePoints = []
    this.cropPoints = []
    this.pendingExportSheets = null
    this.bufferPicking = false
    this.routePicking = false
    this.measureActive = false
    this.cropPicking = false

    if (!window.L) {
      this.setStatus("Map library could not load")
      this.loadingPanelTarget.classList.add("is-hidden")
      return
    }

    this.applyTranslations()
    this.initMap()
    this.setInitialView()
    this.trackNav()
    this.boundBeforePrint = () => this.handleBeforePrint()
    this.boundAfterPrint = () => this.handleAfterPrint()
    window.addEventListener("beforeprint", this.boundBeforePrint)
    window.addEventListener("afterprint", this.boundAfterPrint)
    this.loadData()
  }

  initMap() {
    const L = window.L
    this.map = L.map(this.mapTarget, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 8,
      maxZoom: 18,
      // SVG keeps click hit areas scoped to the actual feature. Canvas panes otherwise
      // intercept pointer events from layers rendered beneath them.
      preferCanvas: false
    }).setView([21.75, 74.9], 10)

    this.map.createPane("districtPane")
    this.map.createPane("villagePane")
    this.map.createPane("coveragePane")
    this.map.createPane("blockPane")
    this.map.createPane("labelPane")
    this.map.createPane("plantationAreaPane")
    this.map.createPane("plantationPane")
    this.map.createPane("agribusinessPane")
    this.map.createPane("interventionPane")
    this.map.getPane("districtPane").style.zIndex = 360
    this.map.getPane("villagePane").style.zIndex = 380
    this.map.getPane("coveragePane").style.zIndex = 395
    this.map.getPane("blockPane").style.zIndex = 410
    this.map.getPane("labelPane").style.zIndex = 420
    // Plantation land parcels are area polygons: keep them BELOW the point
    // markers so clicks land on the FPO/intervention point sitting on top of a
    // plot, instead of always hitting the plot polygon underneath.
    this.map.getPane("plantationAreaPane").style.zIndex = 430
    this.map.getPane("interventionPane").style.zIndex = 440
    this.map.getPane("agribusinessPane").style.zIndex = 460
    this.map.getPane("plantationPane").style.zIndex = 470

    const lightBase = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxNativeZoom: 16, maxZoom: 18, attribution: "Tiles &copy; Esri"
      })
    const cleanMap = L.layerGroup([lightBase])
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

    this.baseMaps = { clean: cleanMap, street, satellite, humanitarian }
    this.activeBaseMap = "clean"
    cleanMap.addTo(this.map)
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(this.map)
    this.map.on("zoomend", () => this.syncAdminLayers())
    this.map.on("moveend", () => this.updateVillageLabels())
    this.map.on("click", (event) => this.handleMapClick(event))
    this.map.on("mousemove", (event) => this.updateCoordinateStatus(event.latlng))

    // Layer groups
    this.districtLayer = L.layerGroup()
    this.blockLayer = L.layerGroup()
    this.villageLayer = L.layerGroup()
    this.villageLabelLayer = L.layerGroup()
    this.coverageLayer = L.layerGroup()
    this.interventionLayer = L.layerGroup()
    this.agribusinessLayer = L.layerGroup()
    this.plantationLayer = L.layerGroup()
    this.bufferLayer = L.layerGroup().addTo(this.map)
    this.routeLayer = L.layerGroup().addTo(this.map)
    this.measurementLayer = L.layerGroup().addTo(this.map)
    this.locationLayer = L.layerGroup().addTo(this.map)
    this.cropLayer = L.layerGroup().addTo(this.map)
  }

  async loadData() {
    try {
      const base = this.datasetBase()
      const [manifest, blocks, villages, pois, agribusiness, plantations] = await Promise.all([
        this.fetchJson(`${base}/manifest.json`),
        this.fetchJson(`${base}/blocks.geojson`),
        this.fetchJson(`${base}/villages.geojson`),
        this.fetchJson(`${base}/poi_wrd_interventions.geojson`),
        this.fetchJson(`${base}/agribusiness_locations.geojson`),
        this.fetchJson(`${base}/agrohorti_plantations.geojson`)
      ])

      this.manifest = manifest
      this.updateDatasetLabels()
      this.blocks = blocks.features
      this.villages = villages.features
      this.pois = pois.features
      this.agribusinessLocations = agribusiness.features
      this.plantationPlots = plantations.features
      this.mapItems = [...this.pois, ...this.agribusinessLocations, ...this.plantationPlots]
      this.bbox = manifest.bbox
      this.collectFcoNames()
      this.updateProjectionStatus()

      this.coverageVillages = this.coverageVillageKeys()

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

  datasetBase() {
    return this.dataBaseValue || "/api/barwani"
  }

  districtName() {
    return this.manifest?.district || this.manifest?.name || "Selected District"
  }

  districtTitle() {
    return `${this.districtName()} ${this.t("district")}`
  }

  regionLabel() {
    const state = this.manifest?.state || this.manifest?.state_name || this.defaultStateValue || ""
    return [this.districtName(), state].filter(Boolean).join(", ")
  }

  datasetSlug() {
    const raw = this.manifest?.slug || this.districtName()
    return String(raw || "geoportal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "geoportal"
  }

  updateDatasetLabels() {
    if (!this.manifest) return
    if (this.hasDistrictLabelTarget) this.districtLabelTarget.textContent = this.regionLabel()
    if (this.hasDistrictEyebrowTarget) this.districtEyebrowTarget.textContent = this.districtTitle()
    if (this.hasWorkspaceTarget) this.workspaceTarget.setAttribute("aria-label", `${this.districtName()} map workspace`)
    if (this.hasLoadingDatasetTextTarget) this.loadingDatasetTextTarget.textContent = `Loading ${this.districtName()} spatial data`
  }

  coverageVillageKeys() {
    const fromVillages = new Set(
      (this.villages || [])
        .filter((feature) => this.isCoverageValue(feature.properties?.asa_coverage))
        .map((feature) => this.villageKeyForFeature(feature))
        .filter(Boolean)
    )
    if (fromVillages.size) return fromVillages

    return new Set(
      (this.mapItems || [])
        .map((feature) => this.villageKeyForProps(feature.properties || {}))
        .filter(Boolean)
    )
  }

  coverageVillageFeatures() {
    return (this.villages || []).filter((feature) => this.villageKeySetHas(this.coverageVillages, feature.properties))
  }

  assignBlockColors() {
    this.blocks
      .map((f) => f.properties.name)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name, i) => this.blockColors.set(name, this.palette[i % this.palette.length]))
  }

  buildLayers() {
    const L = window.L

    // District layer is a fill-only click surface; block boundaries appear after drill-down.
    L.geoJSON({ type: "FeatureCollection", features: this.blocks }, {
      pane: "districtPane",
      style: { color: "#08251f", weight: 0, opacity: 0, fill: true, fillColor: "#0f9d76", fillOpacity: 0.1, dashArray: null },
      interactive: true,
      onEachFeature: (f, layer) => layer.on("click", () => this.showDistrict())
    }).addTo(this.districtLayer)

    // Villages
    this.villageBoundaryLayers = []
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
    this.villageGeo.eachLayer((layer) => this.villageBoundaryLayers.push(layer))

    const labelIcon = L.divIcon({ className: "village-label-anchor", html: "", iconSize: [0, 0] })
    this.villageLabelMarkers = []
    this.villages.forEach((feature) => {
      const center = this.featureLabelPoint(feature)
      if (!center) return
      const marker = L.marker([center.lat, center.lon], {
        icon: labelIcon,
        interactive: false,
        keyboard: false,
        pane: "labelPane"
      }).bindTooltip(feature.properties.name, {
        permanent: true,
        direction: "center",
        className: "village-tip",
        opacity: 0.82,
        pane: "labelPane"
      })
      marker._isCoverageVillage = this.villageKeySetHas(this.coverageVillages, feature.properties)
      marker._props = feature.properties
      this.villageLabelMarkers.push(marker)
    })

    // ASA coverage villages (subset with interventions)
    const coverageFeatures = this.coverageVillageFeatures()
    this.coverageBoundaryLayers = []
    this.coverageGeo = L.geoJSON({ type: "FeatureCollection", features: coverageFeatures }, {
      pane: "coveragePane",
      style: { color: "#f0a33a", weight: 1.8, fillColor: "#f0a33a", fillOpacity: 0.28 },
      onEachFeature: (f, layer) => {
        layer._props = f.properties
        layer.on("click", () => this.showVillage(f, true))
      }
    })
    this.coverageGeo.eachLayer((layer) => this.coverageBoundaryLayers.push(layer))

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
        radius: isDam ? 6 : 5.2, color: "#fff", weight: 1.3,
        fillColor: isDam ? "#c75b44" : "#0b7d8c", fillOpacity: 0.88
      })
      marker._props = f.properties
      marker._poiIndex = index
      marker.bindTooltip(`${f.properties.activity}: ${f.properties.village || f.properties.name}`, {
        direction: "top",
        sticky: true,
        className: "map-tip"
      })
      marker.on("click", (event) => this.selectMapFeature(event, () => this.showIntervention(f)))
      this.interventionMarkers.push(marker)
    })

    // Aggregated FPO/FPC village locations from the agribusiness workbook.
    this.agribusinessMarkers = []
    this.agribusinessLocations.forEach((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates
      const marker = L.circleMarker([lat, lon], {
        pane: "agribusinessPane",
        radius: 9,
        color: "#25154f",
        weight: 2.2,
        fillColor: "#7d5fb2",
        fillOpacity: 0.96
      })
      marker._props = feature.properties
      marker._itemIndex = index
      marker.bindTooltip(`FPO: ${feature.properties.fpc_name || feature.properties.name}`, {
        direction: "top",
        sticky: true,
        className: "map-tip"
      })
      marker.on("click", (event) => this.selectMapFeature(event, () => this.showAgribusiness(feature)))
      this.agribusinessMarkers.push(marker)
    })

    this.plantationFeatureLayers = []
    this.plantationPlots.forEach((feature, index) => {
      const layer = L.geoJSON(feature, {
        // Polygon plots render on the lower area pane so overlapping FPO /
        // intervention point markers stay clickable on top of them.
        pane: "plantationAreaPane",
        style: {
          color: "#145c24",
          fillColor: "#8bc34a",
          fillOpacity: 0.68,
          weight: 2.4
        },
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
          pane: "plantationPane",
          radius: 8,
          color: "#145c24",
          weight: 2,
          fillColor: "#2f7d32",
          fillOpacity: 0.96
        }),
        onEachFeature: (_feature, plantationLayer) => {
          plantationLayer._props = feature.properties
          plantationLayer._itemIndex = index
          plantationLayer.bindTooltip(`Farmer: ${feature.properties.farmer_name || feature.properties.name}`, {
            direction: "top",
            sticky: true,
            className: "map-tip"
          })
          plantationLayer.on("click", (event) => this.selectMapFeature(event, () => this.showPlantation(feature)))
        }
      })
      layer._props = feature.properties
      layer._itemIndex = index
      this.plantationFeatureLayers.push(layer)
    })
  }

  populateControls(options = {}) {
    const previous = options.preserve ? this.captureFilterState() : null
    this.renderAdminTree(previous?.block, previous?.villageFilter)

    // Project is optional: nothing ticked means every project; ticking ABF (or
    // another project) narrows the map to that project.
    const projects = this.manifest.projects || {}
    const projectItems = this.sortProjects(Object.keys(projects)).map((project) => ({
      value: project,
      label: this.displayProjectLabel(project),
      meta: projects[project],
      checked: false
    }))
    this.renderFilterList("project", this.projectListTarget, projectItems, previous?.project)

    const fyCounts = this.manifest.fy_counts || {}
    this.renderFilterList("fy", this.fyListTarget, Object.keys(fyCounts).filter((fy) => fy && fy !== "Not mapped").sort((a, b) => {
      return b.localeCompare(a)
    }).map((fy) => ({
      value: fy,
      label: fy,
      meta: fyCounts[fy]
    })), previous?.fy)

    this.renderFilterList("vertical", this.verticalListTarget, this.verticalFilterItems(), previous?.vertical)

    this.renderActivityFilterList(previous?.activity)

    this.syncFilterSummaries()
  }

  captureFilterState() {
    return ["project", "fy", "vertical", "activity", "block", "villageFilter"].reduce((state, group) => {
      state[group] = this.selectedFilter(group).selected
      return state
    }, {})
  }

  sortProjects(projectNames) {
    const order = ["LWRD Interventions", "ABF", "Agrohorti", "ITX", "Agribusiness"]
    return [...projectNames].sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return a.localeCompare(b)
    })
  }

  displayProjectLabel(project) {
    return {
      "LWRD Interventions": "LWRD Interventions",
      ABF: "ABF",
      ITX: "ITX",
      Agrohorti: "Agrohorti",
      Agribusiness: "Agribusiness"
    }[project] || project
  }

  verticalCounts() {
    return (this.manifest.verticals || []).reduce((counts, vertical) => {
      counts[vertical.name] = vertical.item_count || vertical.poi_count || 0
      return counts
    }, {})
  }

  verticalFilterItems() {
    const counts = this.verticalCounts()
    // Only surface verticals that actually have data.
    return [
      { value: "WRD", label: "WRD", meta: counts.WRD || 0 },
      { value: "Plantation", label: this.displayVerticalLabel("Plantation"), meta: counts.Plantation || 0 },
      { value: "Sustainable Agriculture", label: this.displayVerticalLabel("Sustainable Agriculture"), meta: counts["Sustainable Agriculture"] || 0 },
      { value: "Agribusiness", label: this.displayVerticalLabel("Agribusiness"), meta: counts.Agribusiness || 0 }
    ].filter((item) => item.meta > 0)
  }

  activityFilterGroups() {
    const counts = this.manifest.activity_counts || {}
    return [
      {
        heading: "WRD",
        items: [
          { value: "Dugwell", label: this.displayActivityLabel("Dugwell"), meta: counts.Dugwell || 0 },
          { value: "Stop Dam", label: this.displayActivityLabel("Stop Dam"), meta: counts["Stop Dam"] || 0 }
        ]
      },
      {
        heading: this.displayVerticalLabel("Plantation"),
        items: [
          { value: "Agro Forestry", label: this.displayActivityLabel("Agro Forestry"), meta: counts["Agro Forestry"] || 0 },
          { value: "Agrohorti Plantation", label: this.displayActivityLabel("Agrohorti Plantation"), meta: counts["Agrohorti Plantation"] || 0 }
        ]
      },
      {
        heading: this.displayVerticalLabel("Sustainable Agriculture"),
        items: [
          { value: "Seed Distribution", label: this.displayActivityLabel("Seed Distribution"), meta: counts["Seed Distribution"] || 0 },
          { value: "Biochar", label: this.displayActivityLabel("Biochar"), meta: counts.Biochar || 0 }
        ]
      },
      {
        heading: this.displayVerticalLabel("Agribusiness"),
        items: [
          { value: "FPO Location", label: this.displayActivityLabel("FPO Location"), meta: counts["FPO Location"] || 0 },
          { value: "Procurement Center", label: this.displayActivityLabel("Procurement Center"), meta: counts["Procurement Center"] || counts.Procurement || 0 },
          { value: "Warehouse", label: this.displayActivityLabel("Warehouse"), meta: counts.Warehouse || 0 }
        ]
      }
    ]
      // Drop interventions with no data, and any heading left with no items.
      .map((group) => ({ heading: group.heading, items: group.items.filter((item) => item.meta > 0) }))
      .filter((group) => group.items.length > 0)
  }

  renderActivityFilterList(selectedValues = null) {
    this.activityListTarget.replaceChildren()
    this.activityFilterGroups().forEach((group) => {
      const heading = document.createElement("p")
      heading.className = "filter-group-heading"
      heading.textContent = group.heading
      this.activityListTarget.append(heading)
      this.renderFilterList("activity", this.activityListTarget, group.items, selectedValues, { append: true })
    })
  }

  displayVerticalLabel(vertical) {
    return {
      WRD: "WRD",
      Plantation: this.t("forestry"),
      "Sustainable Agriculture": this.t("sustainableAgriculture"),
      Agribusiness: this.t("agribusiness")
    }[vertical] || vertical
  }

  displayActivityLabel(activity) {
    return {
      Dugwell: this.t("dugwell"),
      "Stop Dam": this.t("stopDam"),
      "Agro Forestry": this.t("agroForestry"),
      "Agrohorti Plantation": this.t("agrohorti"),
      "Seed Distribution": this.t("seedDistribution"),
      Biochar: this.t("biochar"),
      "FPO Location": this.t("fpoLocation"),
      "Procurement Center": this.t("procurement"),
      Procurement: this.t("procurement"),
      Warehouse: this.t("warehouse")
    }[activity] || activity
  }

  blockItemCounts() {
    return (this.mapItems || []).reduce((counts, feature) => {
      const block = feature.properties?.block
      if (block) counts[block] = (counts[block] || 0) + 1
      return counts
    }, {})
  }

  villageItemCounts() {
    return (this.mapItems || []).reduce((counts, feature) => {
      const key = this.villageKeyForProps(feature.properties || {})
      const fallbackKey = this.coverageKey(feature.properties?.block, feature.properties?.village)
      if (key) counts[key] = (counts[key] || 0) + 1
      if (fallbackKey && fallbackKey !== key) counts[fallbackKey] = (counts[fallbackKey] || 0) + 1
      return counts
    }, {})
  }

  renderFilterList(group, list, items, selectedValues = null, options = {}) {
    if (!options.append) list.replaceChildren()
    items.forEach((item) => {
      const label = document.createElement("label")
      label.className = "check-row filter-row"

      const input = document.createElement("input")
      input.type = "checkbox"
      input.value = item.value
      input.disabled = Boolean(item.disabled)
      input.checked = selectedValues
        ? selectedValues.has(item.value)
        : (item.checked !== undefined ? item.checked : false)
      input.dataset.geoportalTarget = `${group}Check`
      input.dataset.filterGroup = group
      input.dataset.label = item.label
      input.dataset.action = group === "block" ? "change->geoportal#blockFilterChanged" : "change->geoportal#filterChanged"

      const text = document.createElement("span")
      text.textContent = item.label

      const meta = document.createElement("em")
      meta.textContent = Number(item.meta || 0).toLocaleString("en-IN")

      label.classList.toggle("is-disabled", input.disabled)
      label.append(input, text, meta)
      list.append(label)
    })
  }

  renderAdminTree(selectedBlockValues = null, selectedVillageValues = null) {
    if (!this.hasAdminTreeTarget || !this.blocks || !this.villages) return
    const blockCounts = this.blockItemCounts()
    const villageCounts = this.villageItemCounts()
    const blockSelection = selectedBlockValues || new Set()
    const villageSelection = selectedVillageValues || new Set()
    const allBlocksSelected = selectedBlockValues !== null && selectedBlockValues.size === this.blocks.length
    const allVillagesSelected = selectedVillageValues !== null && selectedVillageValues.size === this.villages.length
    const oneBlockSelected = selectedBlockValues?.size === 1

    const root = document.createElement("details")
    root.className = "boundary-node boundary-root"
    root.open = true
    root.append(this.boundarySummary({
      layer: "district",
      label: this.t("district"),
      meta: this.districtName(),
      checked: false
    }))

    const body = document.createElement("div")
    body.className = "boundary-children"

    const blockBranch = document.createElement("details")
    blockBranch.className = "boundary-node boundary-layer-node"
    blockBranch.open = true
    blockBranch.append(this.boundarySummary({
      layer: "block",
      label: this.t("allBlocks"),
      meta: `${this.blocks.length.toLocaleString("en-IN")} ${this.t("blocks")}`,
      checked: allBlocksSelected,
      action: "change->geoportal#toggleAllBlocks",
      scope: "blocks"
    }))

    const blockList = document.createElement("div")
    blockList.className = "boundary-block-list"
    const selectionBar = document.createElement("div")
    selectionBar.className = "boundary-selection-bar"
    selectionBar.dataset.boundarySelectionSummary = "true"
    this.villagesByBlock().forEach(([blockName, villages]) => {
      const blockFeature = this.blocks.find((feature) => feature.properties.name === blockName)
      const selected = allBlocksSelected || blockSelection.has(blockName)
      blockList.append(this.boundaryBlockNode({
        blockFeature,
        blockName,
        villages,
        selected,
        selectedVillageValues: villageSelection,
        allVillagesSelected,
        villageCounts,
        open: oneBlockSelected && selected,
        itemCount: blockCounts[blockName] || 0
      }))
    })
    blockBranch.append(selectionBar, blockList)
    body.append(blockBranch)

    const overlays = document.createElement("div")
    overlays.className = "boundary-overlay-group"
    const overlayTitle = document.createElement("p")
    overlayTitle.textContent = this.t("mapDisplay")
    overlays.append(
      overlayTitle,
      this.boundaryCheckboxRow("village", this.t("villageBoundaries"), `${this.villages.length.toLocaleString("en-IN")} ${this.t("villages")}`),
      this.boundaryCheckboxRow("coverage", this.t("coverageBoundaries"), `${this.coverageVillages.size.toLocaleString("en-IN")} ${this.t("villages")}`)
    )
    body.append(overlays)
    root.append(body)

    this.adminTreeTarget.replaceChildren(root)
    this.syncBoundarySelectionUi()
  }

  villagesByBlock() {
    const groups = new Map()
    this.villages.forEach((feature) => {
      const block = feature.properties.block || this.t("block")
      if (!groups.has(block)) groups.set(block, [])
      groups.get(block).push(feature)
    })
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([block, villages]) => [block, villages.sort((a, b) => a.properties.name.localeCompare(b.properties.name))])
  }

  boundarySummary({ layer, label, meta, checked = null, action = "change->geoportal#adminToggle", scope = null }) {
    const summary = document.createElement("summary")
    summary.className = "boundary-summary"
    const row = document.createElement("span")
    row.className = "boundary-summary-row"

    if (layer) {
      const input = document.createElement("input")
      input.type = "checkbox"
      input.checked = checked === null ? Boolean(this.layerState[layer]) : Boolean(checked)
      if (action === "change->geoportal#adminToggle") input.dataset.layer = layer
      if (scope) input.dataset.boundaryScope = scope
      input.dataset.action = action
      input.addEventListener("click", (event) => event.stopPropagation())
      row.append(input)
    }

    const text = document.createElement("span")
    text.textContent = label
    row.append(text)

    const count = document.createElement("em")
    count.textContent = meta
    const chevron = document.createElement("i")
    chevron.className = "boundary-node-chevron"
    chevron.setAttribute("aria-hidden", "true")
    summary.append(row, count, chevron)
    return summary
  }

  boundaryCheckboxRow(layer, label, meta) {
    const row = document.createElement("label")
    row.className = "check-row boundary-check-row"

    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = Boolean(this.layerState[layer])
    input.dataset.layer = layer
    input.dataset.action = "change->geoportal#adminToggle"

    const text = document.createElement("span")
    text.textContent = label

    const count = document.createElement("em")
    count.textContent = meta
    row.append(input, text, count)
    return row
  }

  boundaryBlockNode({ blockFeature, blockName, villages, selected, selectedVillageValues, allVillagesSelected, villageCounts, open, itemCount }) {
    const details = document.createElement("details")
    details.className = "boundary-node boundary-block-node"
    details.open = open
    details.classList.toggle("is-selected", selected)

    const summary = document.createElement("summary")
    summary.className = "boundary-branch-summary"
    const row = document.createElement("span")
    row.className = "boundary-summary-row"

    const input = document.createElement("input")
    input.type = "checkbox"
    input.value = blockName
    input.checked = selected
    input.dataset.geoportalTarget = "blockCheck"
    input.dataset.filterGroup = "block"
    input.dataset.label = blockName
    input.dataset.action = "change->geoportal#blockFilterChanged"
    input.setAttribute("aria-label", `${this.t("block")}: ${blockName}`)
    input.addEventListener("click", (event) => event.stopPropagation())

    const name = document.createElement("button")
    name.type = "button"
    name.className = "boundary-focus-button"
    name.dataset.boundaryBlockName = blockName
    name.dataset.action = "click->geoportal#focusBoundaryBlock"
    const type = document.createElement("small")
    type.className = "boundary-row-type boundary-row-type-block"
    type.textContent = this.t("block")
    const title = document.createElement("span")
    title.textContent = blockName
    name.append(type, title)
    row.append(input, name)

    const count = document.createElement("em")
    const villageCountText = `${villages.length.toLocaleString("en-IN")} ${this.t("villages")}`
    const selectedVillageCount = allVillagesSelected
      ? villages.length
      : villages.filter((village) => selectedVillageValues.has(this.villageKeyForFeature(village))).length
    const selectionText = selectedVillageCount === villages.length
      ? villageCountText
      : `${selectedVillageCount.toLocaleString("en-IN")}/${villages.length.toLocaleString("en-IN")} ${this.t("villages")}`
    count.textContent = itemCount ? `${selectionText} / ${itemCount.toLocaleString("en-IN")} items` : selectionText
    const chevron = document.createElement("i")
    chevron.className = "boundary-node-chevron"
    chevron.setAttribute("aria-hidden", "true")
    summary.append(row, count, chevron)

    const villageList = document.createElement("div")
    villageList.className = "boundary-village-list"

    villages.forEach((village) => {
      const villageKey = this.villageKeyForFeature(village)
      const row = document.createElement("div")
      row.className = "check-row boundary-village-check-row"
      row.tabIndex = 0
      row.dataset.boundaryBlockName = blockName
      row.dataset.boundaryVillageName = village.properties.name
      row.dataset.boundaryVillageLgd = village.properties.lgd_code || ""
      row.addEventListener("click", (event) => {
        if (event.target === checkbox) return
        this.focusVillageFeature(blockName, village.properties.name, village.properties.lgd_code)
      })
      row.addEventListener("keydown", (event) => {
        if (event.target === checkbox) return
        if (!["Enter", " "].includes(event.key)) return
        event.preventDefault()
        this.focusVillageFeature(blockName, village.properties.name, village.properties.lgd_code)
      })

      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.value = villageKey
      checkbox.checked = allVillagesSelected || selectedVillageValues.has(villageKey)
      checkbox.dataset.geoportalTarget = "villageFilterCheck"
      checkbox.dataset.filterGroup = "villageFilter"
      checkbox.dataset.label = village.properties.name
      checkbox.dataset.block = blockName
      checkbox.dataset.village = village.properties.name
      checkbox.dataset.lgdCode = village.properties.lgd_code || ""
      checkbox.dataset.action = "change->geoportal#villageFilterChanged"
      checkbox.setAttribute("aria-label", `${village.properties.name}, ${blockName}`)

      const type = document.createElement("small")
      type.className = "boundary-row-type"
      type.textContent = this.t("village")
      const name = document.createElement("span")
      name.textContent = village.properties.name
      const meta = document.createElement("em")
      const count = villageCounts[villageKey] || 0
      meta.textContent = count ? `${count.toLocaleString("en-IN")} items` : (village.properties.lgd_code || "LGD NA")
      row.append(checkbox, type, name, meta)
      villageList.append(row)
    })

    details.append(summary, villageList)
    details._blockFeature = blockFeature
    return details
  }

  focusBoundaryBlock(event) {
    event.preventDefault()
    event.stopPropagation()
    const blockName = event.currentTarget.dataset.boundaryBlockName
    this.focusBlockFeature(blockName)
  }

  focusBoundaryVillage(event) {
    event.preventDefault()
    event.stopPropagation()
    const blockName = event.currentTarget.dataset.boundaryBlockName
    const villageName = event.currentTarget.dataset.boundaryVillageName
    const lgdCode = event.currentTarget.dataset.boundaryVillageLgd
    this.focusVillageFeature(blockName, villageName, lgdCode)
  }

  findVillageFeature(blockName, villageName, lgdCode = "") {
    return this.villages.find((village) => {
      return village.properties.block === blockName &&
        (village.properties.name === villageName || String(village.properties.lgd_code || "") === String(lgdCode || ""))
    })
  }

  setVillagesForBlock(blockName, checked, options = {}) {
    this.filterInputs("villageFilter").forEach((input) => {
      input.checked = options.only ? input.dataset.block === blockName : (input.dataset.block === blockName ? checked : input.checked)
    })
  }

  syncBlockCheckFromVillages(blockName) {
    const blockInput = this.filterInputs("block").find((input) => input.value === blockName)
    if (!blockInput) return
    const villages = this.filterInputs("villageFilter").filter((input) => input.dataset.block === blockName)
    const checkedVillages = villages.filter((input) => input.checked).length
    blockInput.checked = checkedVillages > 0
    blockInput.indeterminate = checkedVillages > 0 && checkedVillages < villages.length
  }

  setExplicitEmptyFilter(group, active) {
    if (!this.explicitEmptyFilters) this.explicitEmptyFilters = new Set()
    if (active) this.explicitEmptyFilters.add(group)
    else this.explicitEmptyFilters.delete(group)
  }

  updateExplicitEmptyFilter(group) {
    const filter = this.selectedFilter(group)
    this.setExplicitEmptyFilter(group, filter.total > 0 && filter.selected.size === 0)
  }

  toggleAllBlocks(event) {
    const checked = event.currentTarget.checked
    this.mapItemsVisible = checked
    this.updatePresetButtons("custom")
    this.clearDetails()
    this.setFilterChecks("block", () => checked)
    this.setFilterChecks("villageFilter", () => checked)
    this.setExplicitEmptyFilter("block", !checked)
    this.setExplicitEmptyFilter("villageFilter", !checked)
    this.setAdminLayer("block", checked)
    this.setAdminLayer("village", checked)
    this.setAdminLayer("villageLabels", checked)
    if (!checked) this.setAdminLayer("coverage", false)
    this.filterChanged()
    this.syncAdminLayers()
    this.syncBoundarySelectionUi()
    if (checked) this.applyBounds()
  }

  syncBoundarySelectionUi() {
    const blockInputs = this.filterInputs("block")
    const villageInputs = this.filterInputs("villageFilter")
    const checkedBlocks = blockInputs.filter((input) => input.checked).length
    const checkedVillages = villageInputs.filter((input) => input.checked).length
    this.element.querySelectorAll("[data-boundary-scope='blocks']").forEach((input) => {
      input.checked = blockInputs.length > 0 && checkedBlocks === blockInputs.length
      input.indeterminate = checkedBlocks > 0 && checkedBlocks < blockInputs.length
    })
    this.element.querySelectorAll("[data-boundary-selection-summary]").forEach((node) => {
      const blocksText = checkedBlocks === blockInputs.length
        ? this.t("allBlocks")
        : `${checkedBlocks.toLocaleString("en-IN")} ${this.t("blocks")}`
      const villagesText = checkedVillages === villageInputs.length
        ? `${this.villages.length.toLocaleString("en-IN")} ${this.t("villages")}`
        : `${checkedVillages.toLocaleString("en-IN")} ${this.t("villages")}`
      const label = document.createElement("span")
      label.textContent = this.t("selected")
      const blocks = document.createElement("strong")
      blocks.textContent = blocksText
      const villages = document.createElement("em")
      villages.textContent = villagesText
      node.replaceChildren(label, blocks, villages)
    })

    blockInputs.forEach((blockInput) => {
      const villages = villageInputs.filter((input) => input.dataset.block === blockInput.value)
      const checkedVillages = villages.filter((input) => input.checked).length
      blockInput.indeterminate = checkedVillages > 0 && checkedVillages < villages.length
    })
  }

  focusBlockFeature(blockName, feature = null) {
    feature = feature || this.blocks.find((block) => block.properties.name === blockName)
    if (!feature) return

    this.mapItemsVisible = true
    this.updatePresetButtons("custom")
    this.clearDetails()
    this.checkOnlyValue("block", blockName)
    this.setVillagesForBlock(blockName, true, { only: true })
    this.setExplicitEmptyFilter("block", false)
    this.setExplicitEmptyFilter("villageFilter", false)
    this.setAdminLayer("block", true)
    this.setAdminLayer("village", true)
    this.setAdminLayer("villageLabels", true)
    this.setAdminLayer("coverage", true)
    this.filterChanged()
    this.syncAdminLayers()
    if (feature.properties.bbox) this.fitBbox(feature.properties.bbox)
    this.renderBlockDetails(feature)
  }

  focusVillageFeature(blockName, villageName, lgdCode = "") {
    const feature = this.findVillageFeature(blockName, villageName, lgdCode)
    if (!feature) return

    this.mapItemsVisible = true
    this.updatePresetButtons("custom")
    this.clearDetails()
    this.checkOnlyValue("block", blockName)
    this.checkOnlyValue("villageFilter", this.villageKeyForFeature(feature))
    this.setExplicitEmptyFilter("block", false)
    this.setExplicitEmptyFilter("villageFilter", false)
    this.setAdminLayer("block", true)
    this.setAdminLayer("village", true)
    this.setAdminLayer("villageLabels", true)
    this.setAdminLayer("coverage", true)
    this.filterChanged()
    this.syncAdminLayers()
    if (feature.properties.bbox) this.fitBbox(feature.properties.bbox)
    this.showVillage(feature, this.villageKeySetHas(this.coverageVillages, feature.properties))
  }

  collectFcoNames() {
    this.fcoNames = new Set()
    ;(this.agribusinessLocations || []).forEach((feature) => {
      const raw = feature.properties?.fco_names
      if (!raw) return
      String(raw).split(/[,;/|]/).map((name) => name.trim()).filter(Boolean).forEach((name) => this.fcoNames.add(name))
    })
  }

  visibleMarkerCounts() {
    const counts = { Dugwell: 0, "Stop Dam": 0, "FPO Location": 0, "Agrohorti Plantation": 0 }
    if (this.visiblePoiIndexes) {
      this.visiblePoiIndexes.forEach((index) => {
        const activity = this.pois[index]?.properties?.activity
        if (counts[activity] !== undefined) counts[activity] += 1
      })
    }
    counts["FPO Location"] = this.visibleAgribusinessIndexes ? this.visibleAgribusinessIndexes.size : 0
    counts["Agrohorti Plantation"] = this.visiblePlantationIndexes ? this.visiblePlantationIndexes.size : 0
    return counts
  }

  // Legend reflects what is actually on the map right now, so every visible
  // marker/boundary is explained (FCO/UCS included).
  renderLegend() {
    if (!this.manifest || !this.hasLegendTarget) return
    const c = this.manifest.counts
    const items = []
    if (this.layerState.district) items.push(["district", this.t("district"), this.districtName()])
    if (this.layerState.block) items.push(["block", this.t("block"), `${c.blocks} ${this.t("blocks")}`])
    if (this.layerState.village) items.push(["village", this.t("village"), `${c.villages} ${this.t("villages")}`])
    if (this.layerState.coverage) items.push(["coverage", this.t("coverageVillage"), `${this.coverageVillages.size} ${this.t("villages")}`])

    const counts = this.visibleMarkerCounts()
    if (counts.Dugwell) items.push(["well", this.displayActivityLabel("Dugwell"), `${counts.Dugwell}`])
    if (counts["Stop Dam"]) items.push(["dam", this.displayActivityLabel("Stop Dam"), `${counts["Stop Dam"]}`])
    if (counts["FPO Location"]) {
      items.push(["fpo", this.displayActivityLabel("FPO Location"), `${counts["FPO Location"]}`])
      if (this.fcoNames && this.fcoNames.size) {
        const fcoList = [...this.fcoNames]
        const fcoMeta = fcoList.length === 1 ? fcoList[0] : `${fcoList.length} FCO/UCS`
        items.push(["fco", this.t("fcoUcs"), fcoMeta])
      }
    }
    if (counts["Agrohorti Plantation"]) items.push(["plantation", this.displayVerticalLabel("Plantation"), `${counts["Agrohorti Plantation"]}`])

    this.legendTarget.innerHTML = ""
    if (!items.length) {
      this.legendTarget.innerHTML = `<p class="empty-state">${this.t("noneSelected")}</p>`
      return
    }
    items.forEach(([cls, label, meta]) => {
      const row = document.createElement("div")
      row.className = "legend-item"
      row.innerHTML = `<i class="sw sw-${cls}"></i><div><strong>${label}</strong>${meta ? `<span>${meta}</span>` : ""}</div>`
      this.legendTarget.append(row)
    })
  }

  // ---- Admin boundary checkboxes ----
  adminToggle(event) {
    const input = event.target
    const layer = input.dataset.layer
    if (layer) {
      this.layerState[layer] = input.checked
      this.manualAdminLayers.add(layer)
    }
    if (layer === "block") {
      this.setFilterChecks("block", () => input.checked)
      this.setFilterChecks("villageFilter", () => input.checked)
      this.setExplicitEmptyFilter("block", !input.checked)
      this.setExplicitEmptyFilter("villageFilter", !input.checked)
      if (input.checked) {
        this.mapItemsVisible = true
        this.setAdminLayer("village", true)
        this.setAdminLayer("villageLabels", true)
      } else {
        this.setAdminLayer("village", false)
        this.setAdminLayer("villageLabels", false)
        this.setAdminLayer("coverage", false)
      }
      this.syncBoundarySelectionUi()
      this.syncFilterSummaries()
    } else if (layer === "village") {
      this.setAdminLayer("villageLabels", input.checked)
    } else if (layer === "coverage") {
      if (!this.layerState.village) this.setAdminLayer("villageLabels", false)
    }
    this.syncAdminLayers()
    this.updateAdminSummary()
    this.filterChanged()
    if (input.checked) this.fitAdminLayer(layer)
    this.syncGlobeLayers()
  }

  syncAdminLayers() {
    const map = {
      district: this.districtLayer,
      block: this.blockLayer,
      village: this.villageLayer,
      coverage: this.coverageLayer
    }
    this.updateBoundaryLayers()
    Object.entries(map).forEach(([key, group]) => {
      const visible = key === "block" ? this.blockLayerShouldShow() : this.layerState[key]
      if (visible) group.addTo(this.map)
      else this.map.removeLayer(group)
    })
    this.updateVillageLabels()
    this.updateAdminSummary()
  }

  blockLayerShouldShow() {
    if (!this.map) return Boolean(this.layerState.block)
    if (this.manualAdminLayers?.has("block")) return Boolean(this.layerState.block)
    const selected = this.selectedFilter("block")
    const oneBlockSelected = selected.total > 0 && selected.selected.size === 1 && selected.selected.size !== selected.total
    return Boolean(this.layerState.block || oneBlockSelected)
  }

  updateBoundaryLayers() {
    const blocks = this.selectedBlockNames()
    const villages = this.selectedVillageKeys()
    this.villageLayer?.clearLayers()
    this.coverageLayer?.clearLayers()

    this.villageBoundaryLayers?.forEach((layer) => {
      if (this.matchesSelectedBlock(blocks, layer._props?.block) && this.matchesSelectedVillage(villages, layer._props)) {
        layer.addTo(this.villageLayer)
      }
    })
    this.coverageBoundaryLayers?.forEach((layer) => {
      if (this.matchesSelectedBlock(blocks, layer._props?.block) && this.matchesSelectedVillage(villages, layer._props)) {
        layer.addTo(this.coverageLayer)
      }
    })
  }

  selectedBlockNames() {
    const filter = this.selectedFilter("block")
    if (filter.selected.size === 0) return filter.emptyMeansAll ? null : filter.selected
    return filter.selected.size === filter.total ? null : filter.selected
  }

  matchesSelectedBlock(selectedBlocks, blockName) {
    return !selectedBlocks || selectedBlocks.has(blockName)
  }

  selectedVillageKeys() {
    const filter = this.selectedFilter("villageFilter")
    if (filter.total === 0) return null
    if (filter.selected.size === 0) return filter.emptyMeansAll ? null : filter.selected
    if (filter.selected.size === filter.total) return null
    return filter.selected
  }

  matchesSelectedVillage(selectedVillages, props = {}) {
    return !selectedVillages || this.villageKeySetHas(selectedVillages, props)
  }

  updateVillageLabels() {
    if (!this.map || !this.villageLabelLayer || !this.villageLabelMarkers) return
    this.villageLabelLayer.clearLayers()
    const selectedBlocks = this.selectedFilter("block")
    const selectedVillages = this.selectedVillageKeys()
    const oneBlockSelected = selectedBlocks.total > 0 && selectedBlocks.selected.size === 1
    const forceLabels = Boolean(this.layerState.villageLabels)
    const blockLevelZoom = this.map.getZoom() >= 12
    const specificVillagesSelected = Boolean(selectedVillages)
    const coverageOnly = Boolean(this.layerState.coverage && !this.layerState.village && !oneBlockSelected && !specificVillagesSelected)
    const showLabels = forceLabels || coverageOnly || oneBlockSelected || specificVillagesSelected || blockLevelZoom
    if (!showLabels) {
      this.map.removeLayer(this.villageLabelLayer)
      return
    }

    const activeBlocks = (selectedBlocks.selected.size === 0 && selectedBlocks.emptyMeansAll) || selectedBlocks.selected.size === selectedBlocks.total ? null : selectedBlocks.selected
    const bounds = this.map.getBounds()
    const showAll = forceLabels || blockLevelZoom || oneBlockSelected || specificVillagesSelected
    const labelBoxes = []
    this.villageLabelMarkers.forEach((marker) => {
      if (activeBlocks && !activeBlocks.has(marker._props?.block)) return
      if (selectedVillages && !this.villageKeySetHas(selectedVillages, marker._props)) return
      if (!bounds.pad(0.15).contains(marker.getLatLng())) return
      if (coverageOnly && !marker._isCoverageVillage) return
      if (!(showAll || marker._isCoverageVillage)) return
      const box = this.labelCollisionBox(marker)
      if (box && labelBoxes.some((placed) => this.boxesOverlap(placed, box))) return
      if (box) labelBoxes.push(box)
      marker.addTo(this.villageLabelLayer)
    })
    this.villageLabelLayer.addTo(this.map)
  }

  updateAdminSummary() {
    if (!this.hasAdminSummaryTarget) return
    const labels = {
      district: this.t("district"),
      block: this.t("block"),
      village: this.t("village"),
      coverage: this.t("coverageVillage")
    }
    const selectable = ["district", "block", "village", "coverage"]
    if (selectable.every((key) => this.layerState[key])) {
      this.adminSummaryTarget.textContent = this.t("allBoundariesNames")
      return
    }
    const active = Object.keys(labels).filter((key) => this.layerState[key]).map((key) => labels[key])
    this.adminSummaryTarget.textContent = active.length ? active.join(", ") : this.t("noneSelected")
  }

  // ---- Filtering interventions ----
  filterChanged(event = null) {
    if (!this.manifest) return
    const eventGroup = event?.currentTarget?.dataset?.filterGroup
    if (eventGroup === "activity") this.syncParentFiltersForActivities()
    if (eventGroup === "vertical") this.syncActivitiesForVerticals()
    if (["fy", "vertical", "activity"].includes(eventGroup)) this.updateExplicitEmptyFilter(eventGroup)
    if (event) {
      this.updatePresetButtons("custom")
      this.clearDetails()
    }
    this.syncFilterSummaries()
    const projects = this.selectedFilter("project")
    const fys = this.selectedFilter("fy")
    const verticals = this.selectedFilter("vertical")
    const activities = this.selectedFilter("activity")
    const blocks = this.selectedFilter("block")
    const villages = this.selectedFilter("villageFilter")
    const query = this.norm(this.searchInputTarget.value)
    if (eventGroup) this.mapItemsVisible = true
    const showInterventions = this.mapItemsVisible && (this.hasInterventionToggleTarget ? this.interventionToggleTarget.checked : true)

    let visible = 0
    this.visiblePoiIndexes.clear()
    this.visibleAgribusinessIndexes.clear()
    this.visiblePlantationIndexes.clear()
    this.interventionMarkers.forEach((marker) => {
      const p = marker._props
      const ok = showInterventions && this.matchesMapItem(p, { projects, fys, verticals, activities, blocks, villages, query })
      if (ok) {
        marker.addTo(this.interventionLayer)
        visible += 1
        this.visiblePoiIndexes.add(marker._poiIndex)
      } else {
        this.interventionLayer.removeLayer(marker)
      }
    })

    this.agribusinessMarkers.forEach((marker) => {
      const p = marker._props
      const ok = showInterventions && this.matchesMapItem(p, { projects, fys, verticals, activities, blocks, villages, query })
      if (ok) {
        marker.addTo(this.agribusinessLayer)
        visible += 1
        this.visibleAgribusinessIndexes.add(marker._itemIndex)
      } else {
        this.agribusinessLayer.removeLayer(marker)
      }
    })

    this.plantationFeatureLayers.forEach((layer) => {
      const p = layer._props
      const ok = showInterventions && this.matchesMapItem(p, { projects, fys, verticals, activities, blocks, villages, query })
      if (ok) {
        layer.addTo(this.plantationLayer)
        visible += 1
        this.visiblePlantationIndexes.add(layer._itemIndex)
      } else {
        this.plantationLayer.removeLayer(layer)
      }
    })

    if (showInterventions) {
      this.plantationLayer.addTo(this.map)
      this.agribusinessLayer.addTo(this.map)
      this.interventionLayer.addTo(this.map)
    } else {
      this.map.removeLayer(this.interventionLayer)
      this.map.removeLayer(this.agribusinessLayer)
      this.map.removeLayer(this.plantationLayer)
    }

    if (this.hasVisibleCountTarget) this.visibleCountTarget.textContent = visible.toLocaleString("en-IN")
    if (this.hasActiveBlocksTarget) {
      const activeBlockCount = this.mapItemsVisible ? (blocks.selected.size === 0 && blocks.emptyMeansAll ? blocks.total : blocks.selected.size) : 0
      this.activeBlocksTarget.textContent = activeBlockCount.toLocaleString("en-IN")
    }
    if (this.hasMapCaptionTarget) this.mapCaptionTarget.textContent = this.caption({ projects, fys, activities, blocks })
    this.setStatus(`${visible.toLocaleString("en-IN")} map items visible`)
    this.updateBoundaryLayers()
    this.updateVillageLabels()
    this.updateGlobeInterventions()
    this.renderLegend()

    // A filter must never leave a detail card open for an item that is no longer on the map.
    this.clearHiddenSelection()
    if (eventGroup) this.fitCurrentFilterSelection(eventGroup)
  }

  selectMapFeature(event, showDetails) {
    if (event?.latlng && this.handleMapClick(event)) return
    if (event?.originalEvent) window.L?.DomEvent.stopPropagation(event.originalEvent)
    showDetails()
  }

  clearHiddenSelection() {
    if (!this.selectedMapItem || this.isSelectedMapItemVisible()) return
    this.clearDetails()
  }

  isSelectedMapItemVisible() {
    const { type, index } = this.selectedMapItem
    if (type === "intervention") return this.visiblePoiIndexes.has(index)
    if (type === "agribusiness") return this.visibleAgribusinessIndexes.has(index)
    if (type === "plantation") return this.visiblePlantationIndexes.has(index)
    return false
  }

  matchesMapItem(props, filters) {
    return this.matchesProjectFilter(filters.projects, props.project || props.theme) &&
      this.matchesFyFilter(filters.fys, props.fy) &&
      this.matchesFilter(filters.verticals, props.vertical) &&
      this.matchesFilter(filters.activities, props.activity) &&
      this.matchesFilter(filters.blocks, props.block) &&
      (this.villageFilterIsBlockBulkSelection(filters.blocks, filters.villages) || this.matchesVillageFilter(filters.villages, props.block, props.village, props.lgd_code)) &&
      (!filters.query || this.searchText(props, [
        "name", "activity", "project", "vertical", "fy", "block", "village", "lgd_code",
        "fpc_name", "farmer_name", "father_husband_name", "khasra_number",
        "irrigation_source", "plant_source", "land_source", "gis_comment",
        "fco_names", "ics_team_names", "crop_names"
      ]).includes(filters.query) || this.norm(Object.keys(props.varieties || {}).join(" ")).includes(filters.query))
  }

  blockFilterChanged(event = null) {
    const input = event?.currentTarget
    if (event) {
      this.updatePresetButtons("custom")
      this.clearDetails()
      if (input?.dataset?.filterGroup === "block") {
        this.setVillagesForBlock(input.value, input.checked)
        if (input.checked) {
          this.setExplicitEmptyFilter("block", false)
          this.setExplicitEmptyFilter("villageFilter", false)
          this.setAdminLayer("block", true)
          this.setAdminLayer("village", true)
          this.setAdminLayer("villageLabels", true)
        }
        this.updateExplicitEmptyFilter("block")
        this.updateExplicitEmptyFilter("villageFilter")
      }
      this.mapItemsVisible = this.filterInputs("block").some((blockInput) => blockInput.checked)
    }
    this.filterChanged()
    this.syncBoundarySelectionUi()
    const selectedBlocks = [...this.selectedFilter("block").selected]
    if (input?.checked) {
      const feature = this.blocks.find((f) => f.properties.name === input.value)
      if (feature?.properties?.bbox) this.fitFeatures([feature], { maxZoom: 12 })
      if (feature) this.renderBlockDetails(feature)
      this.syncAdminLayers()
      return
    }
    if (selectedBlocks.length !== 1) {
      if (!this.fitSelectedBlockFeatures()) this.applyBounds()
      if (this.viewMode === "globe") this.resetGlobeView()
      this.updateVillageLabels()
      return
    }
    const feature = this.blocks.find((f) => f.properties.name === selectedBlocks[0])
    if (feature?.properties?.bbox) this.fitFeatures([feature], { maxZoom: 12 })
    this.updateVillageLabels()
  }

  villageFilterChanged() {
    const event = arguments[0]
    if (event) {
      this.updatePresetButtons("custom")
      this.clearDetails()
      if (event.currentTarget.checked && event.currentTarget.dataset.block) {
        this.filterInputs("block").forEach((input) => {
          if (input.value === event.currentTarget.dataset.block) input.checked = true
        })
        this.setExplicitEmptyFilter("block", false)
        this.setExplicitEmptyFilter("villageFilter", false)
        this.setAdminLayer("block", true)
        this.setAdminLayer("village", true)
        this.setAdminLayer("villageLabels", true)
      }
      if (event.currentTarget.dataset.block) this.syncBlockCheckFromVillages(event.currentTarget.dataset.block)
      this.updateExplicitEmptyFilter("villageFilter")
      this.updateExplicitEmptyFilter("block")
      this.mapItemsVisible = this.filterInputs("villageFilter").some((villageInput) => villageInput.checked)
    }
    this.filterChanged()
    this.syncBoundarySelectionUi()
    if (event?.currentTarget?.checked && event.currentTarget.dataset.block && event.currentTarget.dataset.village) {
      const feature = this.findVillageFeature(event.currentTarget.dataset.block, event.currentTarget.dataset.village, event.currentTarget.dataset.lgdCode)
      if (feature?.properties?.bbox) this.fitFeatures([feature], { maxZoom: 14 })
      if (feature) this.showVillage(feature, this.villageKeySetHas(this.coverageVillages, feature.properties))
      return
    }
    const selectedVillages = [...this.selectedFilter("villageFilter").selected]
    if (selectedVillages.length !== 1) {
      this.fitSelectedVillageFeatures() || this.fitSelectedBlockFeatures() || this.applyBounds()
      return
    }
    const feature = this.villages.find((village) => {
      return this.villageKeyForFeature(village) === selectedVillages[0]
    })
    if (feature?.properties?.bbox) this.fitFeatures([feature], { maxZoom: 14 })
  }

  selectedFilter(group) {
    const inputs = this.filterInputs(group)
    const values = inputs.map((input) => input.value)
    return {
      total: new Set(values).size,
      selected: new Set(inputs.filter((input) => input.checked).map((input) => input.value)),
      emptyMeansAll: !this.explicitEmptyFilters?.has(group)
    }
  }

  matchesFilter(filter, value) {
    if (filter.total === 0 || filter.selected.size === filter.total) return true
    if (filter.selected.size === 0) return filter.emptyMeansAll
    return filter.selected.has(value)
  }

  // Project acts as an optional "highlight" filter: nothing ticked means show
  // every item; ticking ABF narrows the map to ABF items only.
  matchesProjectFilter(filter, value) {
    if (filter.total === 0 || filter.selected.size === 0) return true
    return filter.selected.has(value)
  }

  matchesFyFilter(filter, value) {
    if (filter.total === 0 || filter.selected.size === filter.total) return true
    if (filter.selected.size === 0) return filter.emptyMeansAll
    const missingFy = !value || value === "Not mapped"
    if (missingFy) return false
    return filter.selected.size > 0 && filter.selected.has(value)
  }

  matchesVillageFilter(filter, blockName, villageName, lgdCode = "") {
    if (filter.total === 0 || filter.selected.size === filter.total) return true
    if (filter.selected.size === 0) return filter.emptyMeansAll
    return this.villageKeySetHas(filter.selected, { block: blockName, village: villageName, lgd_code: lgdCode })
  }

  villageFilterIsBlockBulkSelection(blockFilter, villageFilter) {
    if (!blockFilter?.total || !villageFilter?.total) return false
    if (blockFilter.selected.size === 0 || blockFilter.selected.size === blockFilter.total) return false
    if (villageFilter.selected.size === 0 || villageFilter.selected.size === villageFilter.total) return false
    const expected = new Set(
      this.villages
        .filter((feature) => blockFilter.selected.has(feature.properties.block))
        .map((feature) => this.villageKeyForFeature(feature))
        .filter(Boolean)
    )
    if (!expected.size || expected.size !== villageFilter.selected.size) return false
    return [...expected].every((key) => villageFilter.selected.has(key))
  }

  filterInputs(group) {
    return (this[`${group}CheckTargets`] || []).filter((input) => !input.disabled)
  }

  syncParentFiltersForActivities() {
    const activities = this.selectedFilter("activity")
    if (!activities.total || activities.selected.size === 0 || activities.selected.size === activities.total) return

    const verticals = new Set()
    const projects = new Set()
    activities.selected.forEach((activity) => {
      const mapping = this.activityParentFilter(activity)
      if (mapping.vertical) verticals.add(mapping.vertical)
      if (mapping.project) projects.add(mapping.project)
      if (mapping.projects) mapping.projects.forEach((project) => projects.add(project))
    })

    if (verticals.size) this.setFilterChecks("vertical", (input) => verticals.has(input.value))
    if (!projects.size) {
      verticals.forEach((vertical) => this.projectValuesForVertical(vertical).forEach((project) => projects.add(project)))
    }
    if (projects.size) {
      this.setFilterChecks("project", (input) => projects.has(input.value))
    } else if (verticals.size) {
      this.setFilterChecks("project", () => true)
    }
  }

  syncActivitiesForVerticals() {
    const verticals = this.selectedFilter("vertical")
    if (!verticals.total || verticals.selected.size === 0 || verticals.selected.size === verticals.total) return

    const activityByVertical = {
      WRD: ["Dugwell", "Stop Dam"],
      Plantation: ["Agro Forestry", "Agrohorti Plantation"],
      "Sustainable Agriculture": ["Seed Distribution", "Biochar"],
      Agribusiness: ["FPO Location", "Procurement Center", "Warehouse"]
    }
    const allowedActivities = new Set([...verticals.selected].flatMap((vertical) => activityByVertical[vertical] || []))
    if (!allowedActivities.size) return
    this.setFilterChecks("activity", (input) => allowedActivities.has(input.value))

    const allowedProjects = new Set([...verticals.selected].flatMap((vertical) => this.projectValuesForVertical(vertical)))
    if (allowedProjects.size) {
      this.setFilterChecks("project", (input) => allowedProjects.has(input.value))
    } else {
      this.setFilterChecks("project", () => true)
    }
  }

  activityParentFilter(activity) {
    const map = {
      "Agro Forestry": { vertical: "Plantation", projects: ["ABF", "Agrohorti", "ITX"] },
      "Agrohorti Plantation": { vertical: "Plantation", projects: ["ABF", "Agrohorti", "ITX"] },
      "Seed Distribution": { vertical: "Sustainable Agriculture" },
      Biochar: { vertical: "Sustainable Agriculture" },
      "FPO Location": { vertical: "Agribusiness", project: "Agribusiness" },
      "Procurement Center": { vertical: "Agribusiness", project: "Agribusiness" },
      Warehouse: { vertical: "Agribusiness", project: "Agribusiness" },
      Dugwell: { vertical: "WRD", project: "LWRD Interventions" },
      "Stop Dam": { vertical: "WRD", project: "LWRD Interventions" }
    }
    return map[activity] || {}
  }

  projectValuesForVertical(vertical) {
    return {
      WRD: ["LWRD Interventions"],
      Plantation: ["ABF", "Agrohorti", "ITX"],
      Agribusiness: ["Agribusiness"]
    }[vertical] || []
  }

  syncFilterSummaries() {
    this.updateProjectSummary()
    this.updateFilterSummary("fy", this.fySummaryTarget, this.t("allFy"), this.t("noFy"), "FY")
    this.updateFilterSummary("vertical", this.verticalSummaryTarget, this.t("allVerticals"), this.t("noVerticals"), this.t("verticals"))
    this.updateFilterSummary("activity", this.activitySummaryTarget, this.t("allInterventions"), this.t("noInterventions"), this.t("interventions"))
  }

  updateProjectSummary() {
    if (!this.hasProjectSummaryTarget) return
    const checked = this.filterInputs("project").filter((input) => input.checked)
    this.projectSummaryTarget.textContent = checked.length
      ? checked.map((input) => input.dataset.label || input.value).join(", ")
      : this.t("allProjects")
  }

  updateFilterSummary(group, target, allText, noneText, pluralText) {
    const inputs = this.filterInputs(group)
    const checked = inputs.filter((input) => input.checked)
    if (checked.length === 0 || checked.length === inputs.length) {
      target.textContent = allText
    } else if (checked.length <= 2) {
      target.textContent = checked.map((input) => input.dataset.label || input.value).join(", ")
    } else {
      target.textContent = `${checked.length} ${pluralText}`
    }
  }

  checkOnlyValue(group, value) {
    this.filterInputs(group).forEach((input) => {
      input.checked = input.value === value
    })
    this.setExplicitEmptyFilter(group, false)
    this.syncFilterSummaries()
  }

  // ---- Feature detail panels ----
  showDistrict() {
    this.mapItemsVisible = false
    this.explicitEmptyFilters?.clear()
    this.setAllFilterChecks(false)
    this.layerState.district = true
    this.element.querySelectorAll('input[data-layer="district"]').forEach((input) => { input.checked = false })
    this.setAdminLayer("block", false)
    this.setAdminLayer("village", false)
    this.setAdminLayer("villageLabels", false)
    this.setAdminLayer("coverage", false)
    this.syncBoundarySelectionUi()
    this.syncFilterSummaries()
    this.applyBounds()
    this.filterChanged()
    this.syncAdminLayers()
    this.renderDetails(this.districtName(), this.t("district"), [
      ["Blocks", this.manifest.counts.blocks],
      ["Villages", this.manifest.counts.villages],
      ["Map Items", this.manifest.counts.map_items || this.manifest.counts.interventions],
      ["Projection", `${this.manifest.coordinate_reference_system.authority} / ${this.manifest.coordinate_reference_system.name}`]
    ])
  }

  showBlock(f) {
    this.focusBlockFeature(f.properties.name, f)
  }

  renderBlockDetails(f) {
    this.renderDetails(f.properties.name, "Block", [
      ["District", f.properties.district],
      ["Map Items", this.manifest.poi_block_counts[f.properties.name] || 0],
      ["Villages", this.manifest.village_block_counts[f.properties.name] || 0]
    ], f.properties)
  }

  showVillage(f, coverage = false) {
    this.renderDetails(f.properties.name, coverage ? "ASA Coverage Village" : "Village", [
      ["Block", f.properties.block],
      ["District", f.properties.district],
      ["LGD Code", f.properties.lgd_code],
      ["ASA Coverage", f.properties.asa_coverage]
    ], f.properties)
  }

  showIntervention(f) {
    this.selectedMapItem = { type: "intervention", index: this.pois.indexOf(f) }
    this.renderDetails(f.properties.name, "Intervention", [
      ["Type", this.displayActivityLabel(f.properties.activity)],
      ["FY", f.properties.fy],
      ["Vertical", this.displayVerticalLabel(f.properties.vertical)],
      ["Project", f.properties.project || f.properties.theme],
      ["Block", f.properties.block],
      ["Village", f.properties.village],
      ["LGD Code", f.properties.lgd_code],
      ["Latitude", f.geometry.coordinates[1]],
      ["Longitude", f.geometry.coordinates[0]],
      ["Source Folder", f.properties.folder_path],
      ["Inside District", f.properties.inside_boundary]
    ], f.properties)
  }

  showAgribusiness(f) {
    this.selectedMapItem = { type: "agribusiness", index: this.agribusinessLocations.indexOf(f) }
    const token = this.renderDetails(f.properties.fpc_name || f.properties.name, "Agribusiness", [
      ["Type", this.displayActivityLabel(f.properties.activity)],
      ["FY", f.properties.fy],
      ["Vertical", this.displayVerticalLabel(f.properties.vertical)],
      ["Project", f.properties.project],
      ["Block", f.properties.block],
      ["Village", f.properties.village],
      ["FPO/FPC", f.properties.fpc_name],
      ["FCO/UCS", f.properties.fco_names],
      ["FCO/UCS Count", f.properties.fco_count],
      ["ICS Teams", f.properties.ics_team_count],
      ["No. of Villages", f.properties.covered_village_count],
      ["Farmers", f.properties.farmer_count],
      ["Farmer Detail Rows", f.properties.farmer_detail_count],
      ["FPO Holders", f.properties.fpo_holder_count],
      ["Organic Farmers", f.properties.organic_farmer_count],
      ["Crop Name", f.properties.crop_names],
      ["Procurement / Production Qty", this.quantityText(f.properties.production_qtl, "qtl")],
      ["Payment / Bonus", f.properties.payment_bonus],
      ["Approx Income Total", f.properties.approx_income_total],
      ["Irrigation Sources", f.properties.irrigation_sources],
      ["Latitude", f.geometry.coordinates[1]],
      ["Longitude", f.geometry.coordinates[0]],
      ["Location Basis", f.properties.location_basis]
    ], f.properties)
    this.loadAgribusinessFarmers(f.properties.id, token)
  }

  showPlantation(f) {
    this.selectedMapItem = { type: "plantation", index: this.plantationPlots.indexOf(f) }
    this.renderDetails(f.properties.farmer_name || f.properties.name, "Forestry", [
      ["Type", this.displayActivityLabel(f.properties.activity)],
      ["FY", f.properties.fy],
      ["Vertical", this.displayVerticalLabel(f.properties.vertical)],
      ["Project", f.properties.project],
      ["Block", f.properties.block],
      ["Village", f.properties.village],
      ["Farmer ID", f.properties.farmer_id],
      ["Farmer Name", f.properties.farmer_name],
      ["Father/Husband", f.properties.father_husband_name],
      ["Farmer Type", f.properties.farmer_type],
      ["Khasra", f.properties.khasra_number],
      ["Area Ha", f.properties.area_ha],
      ["Area Acre", f.properties.area_acre],
      ["Area Sq Meter", f.properties.area_sq_meter],
      ["Total Plants", f.properties.total_plants],
      ["Varieties", f.properties.varieties],
      ["Irrigation", f.properties.irrigation_source],
      ["Water Availability", f.properties.water_availability],
      ["Soil Type", f.properties.soil_type],
      ["Plant Source", f.properties.plant_source],
      ["Invoice", f.properties.invoice_mapping],
      ["Plant Detail Sheet", f.properties.plantation_detail_source],
      ["Land Source", f.properties.land_source],
      ["Existing Orchard", f.properties.existing_orchard],
      ["GIS Comment", f.properties.gis_comment],
      ["Latitude", f.properties.latitude],
      ["Longitude", f.properties.longitude],
      ["Geometry", f.properties.geometry_type],
      ["Source Sheet", f.properties.source_sheet]
    ], f.properties)
  }

  setAdminLayer(layer, checked) {
    this.layerState[layer] = checked
    this.manualAdminLayers?.delete(layer)
    this.element.querySelectorAll(`input[data-layer="${layer}"]`).forEach((input) => {
      input.checked = checked
    })
  }

  renderDetails(title, kind, rows, props = {}) {
    this.detailFetchToken += 1
    const token = this.detailFetchToken
    const el = this.detailsPanelTarget
    el.classList.remove("is-empty", "is-expanded", "is-export-preview")
    el.classList.add("is-collapsed")
    el.setAttribute("aria-expanded", "false")
    el.onclick = null
    el.onkeydown = null
    el.innerHTML = ""
    const kicker = document.createElement("p")
    kicker.className = "card-label"
    kicker.textContent = kind
    const closeButton = document.createElement("button")
    closeButton.className = "detail-close"
    closeButton.type = "button"
    closeButton.title = "Close details"
    closeButton.setAttribute("aria-label", "Close details")
    closeButton.dataset.action = "geoportal#clearDetails"
    closeButton.textContent = "x"
    closeButton.addEventListener("click", (event) => event.stopPropagation())
    const toggleButton = document.createElement("button")
    toggleButton.className = "detail-toggle"
    toggleButton.type = "button"
    toggleButton.title = "Show details"
    toggleButton.setAttribute("aria-label", "Show details")
    toggleButton.setAttribute("aria-expanded", "false")
    toggleButton.textContent = "⌄"
    toggleButton.addEventListener("click", (event) => this.toggleDetails(event))
    const h = document.createElement("h3")
    h.className = "details-title"
    h.textContent = title
    const dl = document.createElement("dl")
    const usedLabels = new Set()
    this.appendDetailRows(dl, rows, usedLabels)
    el.append(kicker, closeButton, toggleButton, h, dl)
    const extraRows = this.extraDetailRows(props, usedLabels)
    if (extraRows.length) {
      const section = document.createElement("div")
      section.className = "details-section"
      const label = document.createElement("p")
      label.className = "card-label"
      label.textContent = "Source Details"
      const extraDl = document.createElement("dl")
      this.appendDetailRows(extraDl, extraRows, usedLabels)
      section.append(label, extraDl)
      el.append(section)
    }
    return token
  }

  toggleDetails(event = null) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const el = this.detailsPanelTarget
    if (el.classList.contains("is-empty")) return
    const expanded = el.classList.toggle("is-expanded")
    el.classList.toggle("is-collapsed", !expanded)
    el.setAttribute("aria-expanded", expanded ? "true" : "false")
    const toggle = el.querySelector(".detail-toggle")
    if (!toggle) return
    toggle.textContent = expanded ? "⌃" : "⌄"
    toggle.title = expanded ? "Hide details" : "Show details"
    toggle.setAttribute("aria-label", expanded ? "Hide details" : "Show details")
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false")
  }

  clearDetails() {
    this.detailFetchToken += 1
    this.selectedMapItem = null
    const el = this.detailsPanelTarget
    el.classList.add("is-empty")
    el.classList.remove("is-collapsed", "is-expanded", "is-export-preview")
    el.removeAttribute("aria-expanded")
    el.onclick = null
    el.onkeydown = null
    el.innerHTML = '<p class="card-label">Selected Feature</p><p class="empty-state">No feature selected</p>'
  }

  detailValue(value) {
    if (value === null || value === undefined || value === "" || value === "Not mapped") return "Not available"
    if (typeof value === "boolean") return value ? "Yes" : "No"
    if (Array.isArray(value)) {
      if (!value.length) return "Not available"
      if (value.every((item) => typeof item === "object")) return `${value.length.toLocaleString("en-IN")} records`
      return value.length ? value.join(", ") : "Not available"
    }
    if (typeof value === "object") {
      const parts = Object.entries(value).filter(([, val]) => val !== null && val !== undefined && val !== "")
      return parts.length ? parts.map(([key, val]) => `${key}: ${val}`).join(", ") : "Not available"
    }
    return value
  }

  quantityText(value, unit) {
    const number = Number.parseFloat(value)
    if (!Number.isFinite(number) || number <= 0) return null
    return `${number.toLocaleString("en-IN")} ${unit}`
  }

  appendDetailRows(dl, rows, usedLabels) {
    rows.forEach(([term, val]) => {
      usedLabels.add(this.detailKey(term))
      const div = document.createElement("div")
      const dt = document.createElement("dt")
      const dd = document.createElement("dd")
      dt.textContent = term
      dd.textContent = this.detailValue(val)
      div.append(dt, dd)
      dl.append(div)
    })
  }

  extraDetailRows(props, usedLabels) {
    const hidden = new Set(["bbox", "id", "name", "icon", "farmers"])
    return Object.entries(props || {})
      .filter(([key, value]) => !hidden.has(key) && this.hasDetailValue(value))
      .map(([key, value]) => [this.detailLabel(key), value])
      .filter(([label]) => !usedLabels.has(this.detailKey(label)))
      .sort(([a], [b]) => a.localeCompare(b))
  }

  hasDetailValue(value) {
    if (value === null || value === undefined || value === "" || value === "Not mapped") return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.values(value).some((val) => this.hasDetailValue(val))
    return true
  }

  detailLabel(key) {
    const labels = {
      activity: "Type",
      area_acre: "Area Acre",
      area_ha: "Area Ha",
      area_sq_meter: "Area Sq Meter",
      category: "Category",
      approx_income: "Approx Income",
      crop_name: "Crop Name",
      crop_type: "Crop Type",
      existing_orchard: "Existing Orchard",
      farmer_detail_count: "Farmer Detail Rows",
      farmer_id: "Farmer ID",
      farmer_name: "Farmer Name",
      farmer_type: "Farmer Type",
      father_husband_name: "Father/Husband",
      fco_name: "FCO/UCS",
      fco_count: "FCO/UCS Count",
      fco_names: "FCO/UCS",
      fpc_name: "FPO/FPC",
      fpo_holder_count: "FPO Holders",
      folder_path: "Source Folder",
      geometry_type: "Geometry",
      gis_comment: "GIS Comment",
      ics_team_name: "ICS Team",
      ics_team_count: "ICS Team Count",
      ics_team_names: "ICS Teams",
      inside_boundary: "Inside District",
      invoice_mapping: "Invoice",
      irrigation_source: "Irrigation",
      irrigation_sources: "Irrigation Sources",
      khasra_number: "Khasra",
      land_source: "Land Source",
      lgd_code: "LGD Code",
      location_basis: "Location Basis",
      organic_farmer_count: "Organic Farmers",
      plant_source: "Plant Source",
      plantation_detail_source: "Plant Detail Sheet",
      production_qtl: "Production Qty (qtl)",
      covered_village_count: "No. of Villages",
      crop_names: "Crop Name",
      payment_bonus: "Payment / Bonus",
      approx_income_total: "Approx Income Total",
      source_id: "Source ID",
      source_rows: "Source Rows",
      source_sheet: "Source Sheet",
      total_plants: "Total Plants",
      water_availability: "Water Availability"
    }
    return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  }

  detailKey(label) {
    return this.norm(label).replace(/[^a-z0-9]+/g, "")
  }

  async loadAgribusinessFarmers(locationId, token) {
    if (!locationId) return
    const loading = document.createElement("div")
    loading.className = "details-section details-loading"
    loading.textContent = "Loading farmer details..."
    this.detailsPanelTarget.append(loading)

    try {
      const base = this.datasetBase()
      const payload = await this.fetchJson(`${base}/agribusiness_locations/${encodeURIComponent(locationId)}/farmers.json`)
      if (token !== this.detailFetchToken) return
      loading.remove()
      this.appendFarmerDetails(payload.farmers || [])
    } catch (error) {
      if (token !== this.detailFetchToken) return
      loading.textContent = `Farmer details could not load: ${error.message}`
    }
  }

  appendFarmerDetails(farmers) {
    const section = document.createElement("div")
    section.className = "details-section farmer-detail-section"

    const label = document.createElement("p")
    label.className = "card-label"
    label.textContent = `Farmer Details (${farmers.length.toLocaleString("en-IN")})`
    section.append(label)

    if (!farmers.length) {
      const empty = document.createElement("p")
      empty.className = "empty-state"
      empty.textContent = "No farmer rows found for this FPO/FPC."
      section.append(empty)
      this.detailsPanelTarget.append(section)
      return
    }

    this.appendAgribusinessSummary(section, farmers)

    const wrap = document.createElement("div")
    wrap.className = "farmer-table-wrap"
    const table = document.createElement("table")
    table.className = "farmer-table"
    const columns = [
      ["farmer_id", "Farmer ID"],
      ["farmer_name", "Farmer"],
      ["father_husband_name", "Father/Husband"],
      ["village", "Village"],
      ["khasra_no", "Khasra"],
      ["irrigation_source", "Irrigation"],
      ["land_type", "Land"],
      ["crop_name", "Crop"],
      ["is_fpo_holder", "FPO"],
      ["is_organic", "Organic"]
    ]

    const thead = document.createElement("thead")
    const headRow = document.createElement("tr")
    columns.forEach(([, labelText]) => {
      const th = document.createElement("th")
      th.textContent = labelText
      headRow.append(th)
    })
    thead.append(headRow)

    const tbody = document.createElement("tbody")
    const fragment = document.createDocumentFragment()
    farmers.forEach((farmer) => {
      const row = document.createElement("tr")
      columns.forEach(([key]) => {
        const cell = document.createElement("td")
        cell.textContent = this.detailValue(farmer[key])
        row.append(cell)
      })
      fragment.append(row)
    })
    tbody.append(fragment)
    table.append(thead, tbody)
    wrap.append(table)
    section.append(wrap)
    this.detailsPanelTarget.append(section)
  }

  appendAgribusinessSummary(section, farmers) {
    const summary = document.createElement("div")
    summary.className = "agribusiness-summary"
    const organicCount = farmers.filter((farmer) => this.yesValue(farmer.is_organic) || this.yesValue(farmer.is_organic_crop)).length
    const productionQtl = this.sumNumeric(farmers, "production_qtl")
    const paymentBonus = this.sumNumericByPattern(farmers, /(payment|bonus)/i)
    const rows = [
      ["FCO/UCS", this.uniqueText(farmers, "fco_name")],
      ["ICS Teams", this.uniqueText(farmers, "ics_team_name")],
      ["Villages", this.uniqueText(farmers, "village")],
      ["Registered Farmers", farmers.length],
      ["Organic Farmers", organicCount],
      ["Non Organic Farmers", Math.max(0, farmers.length - organicCount)],
      ["Crop Name", this.tallyText(farmers.map((farmer) => farmer.crop_name).filter(Boolean))],
      ["Procurement / Production Qty", productionQtl ? `${productionQtl.toLocaleString("en-IN")} qtl` : null],
      ["Payment / Bonus", paymentBonus ? paymentBonus.toLocaleString("en-IN") : null]
    ]
    this.appendDetailRows(summary, rows, new Set())
    section.append(summary)

    const icsRows = this.icsBreakdownRows(farmers)
    if (!icsRows.length) return

    const breakdown = document.createElement("div")
    breakdown.className = "farmer-table-wrap ics-table-wrap"
    const table = document.createElement("table")
    table.className = "farmer-table ics-table"
    const columns = ["ICS Team", "Villages", "Reg. Farmers", "Organic", "Non Organic", "Crop", "Qty (qtl)"]
    const thead = document.createElement("thead")
    const headRow = document.createElement("tr")
    columns.forEach((column) => {
      const th = document.createElement("th")
      th.textContent = column
      headRow.append(th)
    })
    thead.append(headRow)
    const tbody = document.createElement("tbody")
    icsRows.forEach((row) => {
      const tr = document.createElement("tr")
      row.forEach((value) => {
        const td = document.createElement("td")
        td.textContent = this.detailValue(value)
        tr.append(td)
      })
      tbody.append(tr)
    })
    table.append(thead, tbody)
    breakdown.append(table)
    section.append(breakdown)
  }

  icsBreakdownRows(farmers) {
    const groups = new Map()
    farmers.forEach((farmer) => {
      const ics = farmer.ics_team_name || "Not available"
      if (!groups.has(ics)) groups.set(ics, [])
      groups.get(ics).push(farmer)
    })

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ics, rows]) => {
      const organic = rows.filter((farmer) => this.yesValue(farmer.is_organic) || this.yesValue(farmer.is_organic_crop)).length
      const qty = this.sumNumeric(rows, "production_qtl")
      return [
        ics,
        new Set(rows.map((farmer) => farmer.village).filter(Boolean)).size,
        rows.length,
        organic,
        Math.max(0, rows.length - organic),
        this.tallyText(rows.map((farmer) => farmer.crop_name).filter(Boolean), 3),
        qty ? qty.toLocaleString("en-IN") : null
      ]
    })
  }

  yesValue(value) {
    return ["yes", "y", "true", "1", "organic"].includes(this.norm(value))
  }

  uniqueText(items, key, limit = 4) {
    const values = [...new Set(items.map((item) => item[key]).filter(Boolean))]
    if (!values.length) return null
    const suffix = values.length > limit ? ` +${values.length - limit} more` : ""
    return `${values.length.toLocaleString("en-IN")}: ${values.slice(0, limit).join(", ")}${suffix}`
  }

  tallyText(values, limit = 5) {
    const tally = values.reduce((counts, value) => {
      counts[value] = (counts[value] || 0) + 1
      return counts
    }, {})
    const rows = Object.entries(tally).sort(([, a], [, b]) => b - a)
    if (!rows.length) return null
    const suffix = rows.length > limit ? ` +${rows.length - limit} more` : ""
    return `${rows.slice(0, limit).map(([name, count]) => `${name}: ${count}`).join(", ")}${suffix}`
  }

  sumNumeric(items, key) {
    return items.reduce((sum, item) => {
      const value = Number.parseFloat(String(item[key] || "").replace(/,/g, ""))
      return Number.isFinite(value) ? sum + value : sum
    }, 0)
  }

  sumNumericByPattern(items, pattern) {
    return items.reduce((sum, item) => {
      Object.entries(item).forEach(([key, value]) => {
        if (!pattern.test(key)) return
        const number = Number.parseFloat(String(value || "").replace(/,/g, ""))
        if (Number.isFinite(number)) sum += number
      })
      return sum
    }, 0)
  }

  updateMetrics() {
    this.blocksMetricTarget.textContent = this.manifest.counts.blocks.toLocaleString("en-IN")
    this.villagesMetricTarget.textContent = this.manifest.counts.villages.toLocaleString("en-IN")
    const mapItems = this.manifest.counts.map_items || this.manifest.counts.interventions || this.manifest.counts.pois
    this.interventionMetricTarget.textContent = mapItems.toLocaleString("en-IN")
    this.coverageMetricTarget.textContent = this.coverageVillages.size.toLocaleString("en-IN")
  }

  updateProjectionStatus() {
    const crs = this.manifest?.coordinate_reference_system
    const label = crs?.authority
      ? `${crs.authority} / ${crs.name || "WGS 84"} (${crs.unit || "Degree"})`
      : "EPSG:4326 / WGS 84 (Degree)"
    this.projectionStatusTargets.forEach((target) => { target.textContent = label })
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
    this.setActiveNav(this.viewMode)

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

  activateHome(event) {
    this.setActiveNav("home")
  }

  setActiveNav(mode) {
    this.navLinkTargets.forEach((link) => {
      const nav = link.dataset.nav || link.dataset.view
      link.classList.toggle("is-active", nav === mode)
    })
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
      return this.villageKeySetHas(this.coverageVillages, feature.properties)
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
    if (this.globeInterventionGroup) this.globeInterventionGroup.visible = this.hasInterventionToggleTarget ? this.interventionToggleTarget.checked : true
    this.renderGlobe()
  }

  updateGlobeInterventions() {
    if (!this.globeInterventionMeshes) return
    const showInterventions = this.hasInterventionToggleTarget ? this.interventionToggleTarget.checked : true
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
  toggleMenu(event) {
    this.setMenuCollapsed(!this.workspaceTarget.classList.contains("is-menu-collapsed"))
    event?.currentTarget?.setAttribute("aria-expanded", this.workspaceTarget.classList.contains("is-menu-collapsed") ? "false" : "true")
  }

  collapseMenu() {
    this.setMenuCollapsed(true)
  }

  setMenuCollapsed(collapsed) {
    this.workspaceTarget.classList.toggle("is-menu-collapsed", collapsed)
    this.toolRailButtonTargets.forEach((button) => {
      if (button.dataset.tool === "layers") button.setAttribute("aria-expanded", collapsed ? "false" : "true")
    })
    setTimeout(() => {
      this.map?.invalidateSize()
      if (this.viewMode === "globe") this.resizeGlobe()
    }, 180)
  }

  openTool(event) {
    const tool = event.currentTarget.dataset.tool || "layers"
    const collapsed = this.workspaceTarget.classList.contains("is-menu-collapsed")
    if (tool === "layers" && this.activeTool === "layers" && !collapsed && !event.forceOpen) {
      this.setMenuCollapsed(true)
      return
    }

    this.activeTool = tool
    const [caption, title] = this.panelTitleFor(tool)
    this.toolPanelCaptionTarget.textContent = caption
    this.toolPanelTitleTarget.textContent = title
    this.toolRailButtonTargets.forEach((button) => {
      const active = button.dataset.tool === tool
      button.classList.toggle("is-active", active)
      button.setAttribute("aria-pressed", active ? "true" : "false")
    })
    this.element.querySelectorAll("[data-tool-content]").forEach((section) => {
      section.classList.toggle("is-hidden", section.dataset.toolContent !== tool)
    })
    this.setMenuCollapsed(false)
  }

  toggleLanguage(event) {
    this.language = this.language === "en" ? "hi" : "en"
    event?.currentTarget?.setAttribute("aria-pressed", this.language === "hi" ? "true" : "false")
    this.applyTranslations()
  }

  translations() {
    return {
      en: {
        language: "हिंदी",
        home: "Home",
        map: "Map",
        globe: "Globe",
        layers: "Layer List",
        mapConsole: "Map Console",
        layersFilters: "Layer List",
        lookup: "Lookup",
        analysis: "Analysis",
        lgd: "LGD Code",
        buffer: "Buffer",
        bufferTool: "Buffer Tool",
        compare: "Compare",
        compareTool: "Compare Tool",
        route: "Route",
        routeAnalysis: "Route Analysis",
        all: "All",
        farmerPlots: "Landscape",
        landscape: "Landscape",
        fpo: "FPO",
        fco: "FCO",
        water: "WRD",
        wrdInterventions: "WRD Interventions",
        agribusiness: "Agribusiness",
        forestry: "Forestry",
        sustainableAgriculture: "Sustainable Agriculture",
        agroForestry: "Agro Forestry",
        agrohorti: "Agrohorti",
        dugwell: "Dugwell",
        stopDam: "Stop Dam",
        seedDistribution: "Seed Distribution",
        biochar: "Biochar",
        fpoLocation: "FPO Location",
        procurement: "Procurement",
        warehouse: "Warehouse",
        adminBoundaries: "Administrative Boundaries",
        state: "State",
        district: "District",
        block: "Block",
        village: "Village",
        villages: "villages",
        villageNames: "Village Names",
        fcoUcs: "FCO / UCS",
        coverageVillage: "ASA Coverage Village",
        allBoundariesNames: "All Boundaries + Names",
        mapDisplay: "Map Display",
        villageBoundaries: "Village Boundaries",
        coverageBoundaries: "ASA Coverage Boundaries",
        noneSelected: "None selected",
        dataPending: "data pending",
        project: "Project",
        fy: "FY",
        vertical: "Vertical",
        interventions: "Interventions",
        search: "Search",
        allProjects: "All Projects",
        noProjects: "No Projects",
        projects: "Projects",
        allFy: "All FY",
        noFy: "No FY",
        allVerticals: "All Verticals",
        noVerticals: "No Verticals",
        verticals: "Verticals",
        allInterventions: "All Interventions",
        noInterventions: "No Interventions",
        allBlocks: "All Blocks",
        noBlocks: "No Blocks",
        blocks: "Blocks",
        selected: "Selected",
        lgdLookup: "Village Lookup",
        lgdCode: "LGD Code",
        enterLgdCode: "Enter LGD code",
        bufferRadius: "Buffer Radius",
        distanceKm: "Distance (km)",
        clear: "Clear",
        reset: "Reset",
        layerComparison: "Layer Comparison",
        primaryLayer: "Primary Layer",
        comparisonLayer: "Comparison Layer",
        compareLayers: "Compare Layers",
        routePoints: "Route Points",
        routeLimit: "Up to 8 points",
        addPoint: "Add Point",
        baseMaps: "Base Maps",
        cleanMap: "Clean",
        street: "Street",
        satellite: "Satellite",
        textSearch: "Text",
        locationSearch: "Location",
        currentLocation: "Current Location",
        locating: "Finding current location",
        locationUnavailable: "Current location is not available",
        selectMapLocation: "Select a map location",
        cropTool: "Crop tool active: click two map corners",
        cropSecondPoint: "Click opposite corner to crop",
        cropReady: "Crop area selected",
        mapSearchPlaceholder: "Search village, farmer, FPO",
        locationPlaceholder: "Latitude, Longitude"
      },
      hi: {
        language: "English",
        home: "होम",
        map: "मैप",
        globe: "ग्लोब",
        layers: "लेयर सूची",
        mapConsole: "मैप कंसोल",
        layersFilters: "लेयर सूची",
        lookup: "खोज",
        analysis: "विश्लेषण",
        lgd: "LGD कोड",
        buffer: "बफर",
        bufferTool: "बफर टूल",
        compare: "तुलना",
        compareTool: "तुलना टूल",
        route: "रूट",
        routeAnalysis: "रूट विश्लेषण",
        all: "सभी",
        farmerPlots: "लैंडस्केप",
        landscape: "लैंडस्केप",
        fpo: "FPO",
        fco: "FCO",
        water: "WRD",
        wrdInterventions: "WRD हस्तक्षेप",
        agribusiness: "एग्रीबिजनेस",
        forestry: "फॉरेस्ट्री",
        sustainableAgriculture: "सस्टेनेबल एग्रीकल्चर",
        agroForestry: "एग्रो फॉरेस्ट्री",
        agrohorti: "एग्रो हॉर्टी",
        dugwell: "डगवेल",
        stopDam: "स्टॉप डैम",
        seedDistribution: "बीज वितरण",
        biochar: "बायोचार",
        fpoLocation: "FPO लोकेशन",
        procurement: "प्रोक्योरमेंट",
        warehouse: "वेयरहाउस",
        adminBoundaries: "प्रशासनिक सीमा",
        state: "राज्य",
        district: "जिला",
        block: "ब्लॉक",
        village: "गांव",
        villages: "गांव",
        villageNames: "गांव नाम",
        fcoUcs: "FCO / UCS",
        coverageVillage: "ASA कवरेज गांव",
        allBoundariesNames: "सभी सीमाएं + नाम",
        mapDisplay: "मैप डिस्प्ले",
        villageBoundaries: "गांव सीमाएं",
        coverageBoundaries: "ASA कवरेज सीमाएं",
        noneSelected: "कुछ चयनित नहीं",
        dataPending: "डेटा बाकी",
        project: "प्रोजेक्ट",
        fy: "वित्तीय वर्ष",
        vertical: "वर्टिकल",
        interventions: "हस्तक्षेप",
        search: "खोज",
        allProjects: "सभी प्रोजेक्ट",
        noProjects: "कोई प्रोजेक्ट नहीं",
        projects: "प्रोजेक्ट",
        allFy: "सभी FY",
        noFy: "कोई FY नहीं",
        allVerticals: "सभी वर्टिकल",
        noVerticals: "कोई वर्टिकल नहीं",
        verticals: "वर्टिकल",
        allInterventions: "सभी हस्तक्षेप",
        noInterventions: "कोई हस्तक्षेप नहीं",
        allBlocks: "सभी ब्लॉक",
        noBlocks: "कोई ब्लॉक नहीं",
        blocks: "ब्लॉक",
        selected: "चयनित",
        lgdLookup: "गांव खोज",
        lgdCode: "LGD कोड",
        enterLgdCode: "LGD कोड डालें",
        bufferRadius: "बफर दूरी",
        distanceKm: "दूरी (किमी)",
        clear: "साफ करें",
        reset: "रीसेट",
        layerComparison: "लेयर तुलना",
        primaryLayer: "मुख्य लेयर",
        comparisonLayer: "तुलना लेयर",
        compareLayers: "तुलना करें",
        routePoints: "रूट पॉइंट",
        routeLimit: "8 पॉइंट तक",
        addPoint: "पॉइंट जोड़ें",
        baseMaps: "बेस मैप",
        cleanMap: "क्लीन",
        street: "स्ट्रीट",
        satellite: "सैटेलाइट",
        textSearch: "टेक्स्ट",
        locationSearch: "लोकेशन",
        currentLocation: "वर्तमान लोकेशन",
        locating: "वर्तमान लोकेशन खोज रहे हैं",
        locationUnavailable: "वर्तमान लोकेशन उपलब्ध नहीं है",
        selectMapLocation: "मैप लोकेशन चुनें",
        cropTool: "क्रॉप टूल चालू: मैप पर दो कोने चुनें",
        cropSecondPoint: "क्रॉप के लिए दूसरा कोना चुनें",
        cropReady: "क्रॉप एरिया चयनित",
        mapSearchPlaceholder: "गांव, किसान, FPO खोजें",
        locationPlaceholder: "अक्षांश, देशांतर"
      }
    }
  }

  t(key) {
    const dictionary = this.translations()
    return dictionary[this.language]?.[key] || dictionary.en[key] || key
  }

  panelTitleFor(tool = this.activeTool) {
    const titles = {
      layers: ["mapConsole", "layersFilters"],
      lgd: ["lookup", "lgd"],
      buffer: ["analysis", "bufferTool"],
      compare: ["analysis", "compareTool"],
      route: ["analysis", "routeAnalysis"]
    }
    return (titles[tool] || titles.layers).map((key) => this.t(key))
  }

  applyTranslations() {
    this.element.querySelectorAll("[data-i18n]").forEach((node) => {
      const value = this.t(node.dataset.i18n)
      if (value) node.textContent = value
    })
    this.element.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const value = this.t(node.dataset.i18nPlaceholder)
      if (value) node.placeholder = value
    })
    if (this.hasToolPanelCaptionTarget && this.hasToolPanelTitleTarget) {
      const [caption, title] = this.panelTitleFor()
      this.toolPanelCaptionTarget.textContent = caption
      this.toolPanelTitleTarget.textContent = title
    }
    this.updateSearchPlaceholder()
    this.updateDatasetLabels()
    if (this.manifest) {
      this.populateControls({ preserve: true })
      this.renderLegend()
      this.syncAdminLayers()
    }
  }

  setSearchMode(event) {
    this.searchMode = event.currentTarget.dataset.searchMode || "text"
    this.searchModeButtonTargets.forEach((button) => {
      const active = button.dataset.searchMode === this.searchMode
      button.classList.toggle("is-active", active)
      button.setAttribute("aria-selected", active ? "true" : "false")
    })
    this.updateSearchPlaceholder()
  }

  updateSearchPlaceholder() {
    const placeholders = {
      text: this.t("mapSearchPlaceholder"),
      lgd: this.t("enterLgdCode"),
      location: this.t("locationPlaceholder")
    }
    if (this.hasMapSearchInputTarget) {
      this.mapSearchInputTarget.value = ""
      this.mapSearchInputTarget.placeholder = placeholders[this.searchMode]
    }
  }

  runMapSearch(event) {
    event.preventDefault()
    const query = this.mapSearchInputTarget.value.trim()
    if (!query) return

    if (this.searchMode === "lgd") {
      if (this.hasLgdInputTarget) this.lgdInputTarget.value = query
      this.lookupLgd(event)
      return
    }

    if (this.searchMode === "location") {
      const match = query.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/)
      if (!match) {
        this.setStatus("Use latitude, longitude format")
        return
      }
      const lat = Number.parseFloat(match[1])
      const lon = Number.parseFloat(match[2])
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
      this.focusLocation({ lat, lng: lon }, "Searched Location")
      return
    }

    this.openToolByName("layers")
    this.searchInputTarget.value = query
    this.filterChanged()
    this.fitVisibleMapItems()
  }

  openToolByName(tool) {
    const button = this.toolRailButtonTargets.find((target) => target.dataset.tool === tool)
    if (button) this.openTool({ currentTarget: button, forceOpen: true })
  }

  lookupLgd(event) {
    event.preventDefault()
    const query = this.norm(this.lgdInputTarget.value || this.mapSearchInputTarget?.value)
    if (!query) {
      this.lgdStatusTarget.textContent = "Enter an LGD code"
      return
    }
    const village = this.villages.find((feature) => this.norm(feature.properties.lgd_code) === query)
    if (!village) {
      this.lgdStatusTarget.textContent = "No village found for this LGD code"
      return
    }
    this.setAdminLayer("village", true)
    this.setAdminLayer("villageLabels", true)
    this.syncAdminLayers()
    this.showVillage(village)
    if (village.properties.bbox) this.fitBbox(village.properties.bbox)
    this.lgdStatusTarget.textContent = `${village.properties.name}, ${village.properties.block}`
  }

  activateBuffer() {
    this.openToolByName("buffer")
    this.bufferPicking = true
    this.routePicking = false
    this.measureActive = false
    this.bufferStatusTarget.textContent = "Click on map to place buffer"
    this.setStatus("Buffer tool active")
  }

  clearBuffer() {
    this.bufferPicking = false
    this.bufferLayer.clearLayers()
    this.bufferStatusTarget.textContent = "Select a map location"
    this.setStatus("Buffer cleared")
  }

  placeBuffer(latlng) {
    const distanceKm = Math.max(0.1, Number.parseFloat(this.bufferDistanceInputTarget.value) || 2)
    this.bufferLayer.clearLayers()
    window.L.circle(latlng, {
      radius: distanceKm * 1000,
      color: "#0b7d8c",
      fillColor: "#0f9d76",
      fillOpacity: 0.13,
      weight: 2.2
    }).addTo(this.bufferLayer)
    window.L.circleMarker(latlng, {
      radius: 5,
      color: "#ffffff",
      fillColor: "#0b7d8c",
      fillOpacity: 1,
      weight: 2
    }).addTo(this.bufferLayer)
    this.bufferStatusTarget.textContent = `${distanceKm.toLocaleString("en-IN")} km buffer at ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`
  }

  runComparison() {
    const primary = this.comparisonPrimaryTarget.value
    const secondary = this.comparisonSecondaryTarget.value
    const primaryFeatures = this.featuresForComparison(primary)
    const secondaryFeatures = this.featuresForComparison(secondary)
    const primaryVillages = this.featureVillageKeys(primaryFeatures)
    const secondaryVillages = this.featureVillageKeys(secondaryFeatures)
    const sharedVillages = [...primaryVillages].filter((key) => secondaryVillages.has(key)).length

    this.comparisonResultTarget.innerHTML = `
      <div><strong>${this.comparisonLabel(primaryFeatures.type)}</strong><span>${primaryFeatures.items.length.toLocaleString("en-IN")} items</span></div>
      <div><strong>${this.comparisonLabel(secondaryFeatures.type)}</strong><span>${secondaryFeatures.items.length.toLocaleString("en-IN")} items</span></div>
      <div><strong>${sharedVillages.toLocaleString("en-IN")}</strong><span>common villages</span></div>
    `
  }

  featuresForComparison(type) {
    if (type === "fpo") {
      return { type, items: this.agribusinessLocations.filter((_feature, index) => this.visibleAgribusinessIndexes.has(index)) }
    }
    if (type === "plantation") {
      return { type, items: this.plantationPlots.filter((_feature, index) => this.visiblePlantationIndexes.has(index)) }
    }
    return { type, items: this.pois.filter((_feature, index) => this.visiblePoiIndexes.has(index)) }
  }

  comparisonLabel(type) {
    return { fpo: "FPO Location", plantation: "Landscape", water: "WRD Interventions" }[type] || type
  }

  featureVillageKeys(payload) {
    return new Set(payload.items.map((feature) => this.villageKeyForProps(feature.properties || {})).filter(Boolean))
  }

  startRoute() {
    this.openToolByName("route")
    this.routePicking = true
    this.bufferPicking = false
    this.measureActive = false
    this.setStatus("Route analysis active")
    this.updateRouteStatus()
  }

  clearRoute() {
    this.routePicking = false
    this.routePoints = []
    this.routeLayer.clearLayers()
    this.updateRouteStatus()
    this.setStatus("Route cleared")
  }

  addRoutePoint(latlng) {
    if (this.routePoints.length >= 8) {
      this.routePicking = false
      this.updateRouteStatus()
      return
    }
    this.routePoints.push(latlng)
    this.redrawRoute()
    if (this.routePoints.length >= 8) this.routePicking = false
    this.updateRouteStatus()
  }

  redrawRoute() {
    this.routeLayer.clearLayers()
    this.routePoints.forEach((point, index) => {
      window.L.marker(point, {
        icon: window.L.divIcon({
          className: "route-point-marker",
          html: `<span>${index + 1}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(this.routeLayer)
    })
    if (this.routePoints.length > 1) {
      window.L.polyline(this.routePoints, { color: "#7d5fb2", weight: 4, opacity: 0.9 }).addTo(this.routeLayer)
    }
    this.renderRouteList()
  }

  renderRouteList() {
    this.routeListTarget.replaceChildren()
    this.routePoints.forEach((point, index) => {
      const item = document.createElement("li")
      item.textContent = `${index + 1}. ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
      this.routeListTarget.append(item)
    })
  }

  updateRouteStatus() {
    const distance = this.pathDistance(this.routePoints)
    const suffix = distance ? ` / ${distance.toFixed(2)} km` : ""
    this.routeStatusTarget.textContent = `${this.routePoints.length} / 8 points${suffix}`
  }

  toggleMeasure() {
    this.measureActive = !this.measureActive
    this.bufferPicking = false
    this.routePicking = false
    this.cropPicking = false
    if (!this.measureActive) {
      this.measurePoints = []
      this.measurementLayer.clearLayers()
      this.setStatus("Measure cleared")
      return
    }
    this.setStatus("Measure active: click map points")
  }

  addMeasurePoint(latlng) {
    this.measurePoints.push(latlng)
    this.measurementLayer.clearLayers()
    this.measurePoints.forEach((point) => {
      window.L.circleMarker(point, {
        radius: 4,
        color: "#ffffff",
        fillColor: "#f0a33a",
        fillOpacity: 1,
        weight: 2
      }).addTo(this.measurementLayer)
    })
    if (this.measurePoints.length > 1) {
      const distance = this.pathDistance(this.measurePoints)
      window.L.polyline(this.measurePoints, { color: "#f0a33a", weight: 3, dashArray: "8 7" }).addTo(this.measurementLayer)
      const last = this.measurePoints[this.measurePoints.length - 1]
      window.L.tooltip({ permanent: true, direction: "top", className: "measure-tip" })
        .setLatLng(last)
        .setContent(`${distance.toFixed(2)} km`)
        .addTo(this.measurementLayer)
    }
  }

  pathDistance(points) {
    if (!this.map || points.length < 2) return 0
    let meters = 0
    for (let i = 1; i < points.length; i += 1) meters += this.map.distance(points[i - 1], points[i])
    return meters / 1000
  }

  handleMapClick(event) {
    if (this.bufferPicking) {
      this.placeBuffer(event.latlng)
      return true
    }
    if (this.routePicking) {
      this.addRoutePoint(event.latlng)
      return true
    }
    if (this.cropPicking) {
      this.addCropPoint(event.latlng)
      return true
    }
    if (this.measureActive) {
      this.addMeasurePoint(event.latlng)
      return true
    }
    return false
  }

  updateCoordinateStatus(latlng) {
    if (!this.hasCoordinateStatusTarget || !latlng) return
    this.coordinateStatusTarget.textContent = `${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)}`
  }

  focusDistrict() {
    this.applyBounds()
    this.setStatus("District view")
  }

  locateUser() {
    if (!navigator.geolocation) {
      this.setStatus(this.t("locationUnavailable"))
      return
    }
    this.setStatus(this.t("locating"))
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }
        const accuracy = position.coords.accuracy || 0
        this.showCurrentLocation(latlng, accuracy)
      },
      () => this.setStatus(this.t("locationUnavailable")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  showCurrentLocation(latlng, accuracy) {
    if (this.viewMode === "globe") this.setViewMode("map")
    this.locationLayer.clearLayers()
    window.L.circle(latlng, {
      radius: Math.max(20, accuracy),
      color: "#3c72b8",
      fillColor: "#3c72b8",
      fillOpacity: 0.13,
      weight: 2
    }).addTo(this.locationLayer)
    window.L.circleMarker(latlng, {
      radius: 7,
      color: "#ffffff",
      fillColor: "#3c72b8",
      fillOpacity: 1,
      weight: 2.4
    }).bindTooltip(this.t("currentLocation"), { permanent: true, direction: "top", className: "map-tip" }).addTo(this.locationLayer)
    this.map.setView(latlng, 15)
    this.setStatus(`${this.t("currentLocation")}: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`)
  }

  startCrop() {
    if (this.viewMode === "globe") this.setViewMode("map")
    this.cropPicking = true
    this.bufferPicking = false
    this.routePicking = false
    this.measureActive = false
    this.cropPoints = []
    this.cropLayer.clearLayers()
    this.setStatus(this.t("cropTool"))
  }

  addCropPoint(latlng) {
    this.cropPoints.push(latlng)
    window.L.circleMarker(latlng, {
      radius: 5,
      color: "#ffffff",
      fillColor: "#7d5fb2",
      fillOpacity: 1,
      weight: 2
    }).addTo(this.cropLayer)

    if (this.cropPoints.length < 2) {
      this.setStatus(this.t("cropSecondPoint"))
      return
    }

    const bounds = window.L.latLngBounds(this.cropPoints[0], this.cropPoints[1])
    window.L.rectangle(bounds, {
      color: "#7d5fb2",
      fillColor: "#7d5fb2",
      fillOpacity: 0.08,
      weight: 2.4,
      dashArray: "7 6"
    }).addTo(this.cropLayer)
    this.map.fitBounds(bounds, { padding: [34, 34], maxZoom: 16 })
    this.cropPicking = false
    this.setStatus(this.t("cropReady"))
  }

  focusLocation(latlng, label = "Location") {
    this.measurementLayer.clearLayers()
    window.L.circleMarker(latlng, {
      radius: 7,
      color: "#ffffff",
      fillColor: "#c75b44",
      fillOpacity: 1,
      weight: 2
    }).bindTooltip(label, { permanent: true, direction: "top", className: "map-tip" }).addTo(this.measurementLayer)
    this.map.setView(latlng, 14)
    this.setStatus(`${label}: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`)
  }

  toggleFullscreen() {
    const panel = this.element.querySelector(".map-panel")
    if (!document.fullscreenElement) {
      panel?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
    setTimeout(() => this.map?.invalidateSize(), 180)
  }

  downloadVisibleExcel() {
    const sheets = this.visibleExportSheets()
    const total = sheets.reduce((sum, [, items]) => sum + items.length, 0)
    if (!total) {
      this.pendingExportSheets = null
      this.renderExcelEmptyPreview()
      this.setStatus("No visible data to preview")
      return
    }
    this.pendingExportSheets = sheets
    this.renderExcelPreview(sheets, total)
    this.setStatus(`${total.toLocaleString("en-IN")} visible rows ready for Excel preview`)
  }

  renderExcelEmptyPreview() {
    this.detailFetchToken += 1
    const el = this.detailsPanelTarget
    el.classList.remove("is-empty", "is-collapsed")
    el.classList.add("is-expanded", "is-export-preview")
    el.setAttribute("aria-expanded", "true")
    el.onclick = null
    el.onkeydown = null
    el.innerHTML = ""

    const kicker = document.createElement("p")
    kicker.className = "card-label"
    kicker.textContent = "Excel Preview"

    const closeButton = document.createElement("button")
    closeButton.className = "detail-close"
    closeButton.type = "button"
    closeButton.title = "Close preview"
    closeButton.setAttribute("aria-label", "Close preview")
    closeButton.textContent = "x"
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation()
      this.clearDetails()
    })

    const title = document.createElement("h3")
    title.className = "details-title"
    title.textContent = "No visible rows"

    const message = document.createElement("p")
    message.className = "export-empty-message"
    message.textContent = "Select All, Landscape, FPO, FCO, a project, or any map layer first. Then Excel preview and download will appear here."

    el.append(kicker, closeButton, title, message)
  }

  visibleExportSheets() {
    return [
      ["WRD Interventions", this.pois.filter((_feature, index) => this.visiblePoiIndexes.has(index))],
      ["FPO Locations", this.agribusinessLocations.filter((_feature, index) => this.visibleAgribusinessIndexes.has(index))],
      ["Landscape", this.plantationPlots.filter((_feature, index) => this.visiblePlantationIndexes.has(index))]
    ]
  }

  renderExcelPreview(sheets, total) {
    this.detailFetchToken += 1
    const el = this.detailsPanelTarget
    el.classList.remove("is-empty", "is-collapsed")
    el.classList.add("is-expanded", "is-export-preview")
    el.setAttribute("aria-expanded", "true")
    el.onclick = null
    el.onkeydown = null
    el.innerHTML = ""

    const kicker = document.createElement("p")
    kicker.className = "card-label"
    kicker.textContent = "Excel Preview"

    const closeButton = document.createElement("button")
    closeButton.className = "detail-close"
    closeButton.type = "button"
    closeButton.title = "Close preview"
    closeButton.setAttribute("aria-label", "Close preview")
    closeButton.textContent = "x"
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation()
      this.clearDetails()
    })

    const downloadButton = document.createElement("button")
    downloadButton.className = "export-download-button"
    downloadButton.type = "button"
    downloadButton.textContent = "Download Excel"
    downloadButton.addEventListener("click", (event) => this.downloadPreparedExcel(event))

    const title = document.createElement("h3")
    title.className = "details-title"
    title.textContent = `${total.toLocaleString("en-IN")} visible rows`

    const summary = document.createElement("div")
    summary.className = "export-summary-grid"
    sheets.forEach(([name, features]) => {
      const card = document.createElement("div")
      const count = features.length
      const percent = total ? Math.max(4, Math.round((count / total) * 100)) : 0
      card.className = "export-summary-card"
      card.innerHTML = `
        <span>${this.escapeHtml(name)}</span>
        <strong>${count.toLocaleString("en-IN")}</strong>
        <i><b style="width:${percent}%"></b></i>
      `
      summary.append(card)
    })

    const preview = document.createElement("div")
    preview.className = "export-preview-stack"
    sheets.filter(([, features]) => features.length).forEach(([name, features]) => {
      const columns = this.exportColumns(features)
      const section = document.createElement("section")
      section.className = "export-preview-sheet"
      const heading = document.createElement("h4")
      heading.textContent = `${name} (${features.length.toLocaleString("en-IN")})`
      const tableWrap = document.createElement("div")
      tableWrap.className = "export-preview-table-wrap"
      const table = document.createElement("table")
      table.innerHTML = `
        <thead><tr>${columns.map((column) => `<th>${this.escapeHtml(this.detailLabel(column))}</th>`).join("")}</tr></thead>
        <tbody>${this.exportRows(features).map((row) => `<tr>${columns.map((column) => `<td>${this.escapeHtml(this.detailValue(row[column]))}</td>`).join("")}</tr>`).join("")}</tbody>
      `
      tableWrap.append(table)
      section.append(heading, tableWrap)
      preview.append(section)
    })

    el.append(kicker, closeButton, downloadButton, title, summary, preview)
  }

  downloadPreparedExcel(event = null) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const sheets = this.pendingExportSheets || this.visibleExportSheets()
    const total = sheets.reduce((sum, [, items]) => sum + items.length, 0)
    if (!total) {
      this.setStatus("No visible data to download")
      return
    }
    const workbook = this.excelWorkbookXml(sheets, total)
    const blob = new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${this.datasetSlug()}-visible-map-data-${new Date().toISOString().slice(0, 10)}.xls`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    this.setStatus(`${total.toLocaleString("en-IN")} visible rows exported`)
  }

  excelWorkbookXml(sheets, total) {
    const generated = new Date().toLocaleString("en-IN")
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${this.escapeXml(this.districtTitle())} Visible Map Data</Title>
  <Author>ASA Geoportal</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 ${this.excelXmlStyles()}
 ${this.excelAllDataWorksheet(sheets, total)}
 ${this.excelSummaryWorksheet(sheets, total, generated)}
 ${sheets.filter(([, features]) => features.length).map(([name, features]) => this.excelDataWorksheet(name, features)).join("")}
</Workbook>`
  }

  excelXmlStyles() {
    return `<Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B6F75" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Subtitle"><Font ss:FontName="Arial" ss:Size="10" ss:Color="#21443D"/><Interior ss:Color="#EAF6F1" ss:Pattern="Solid"/><Borders>${this.excelBorders("#B9D8D0")}</Borders></Style>
  <Style ss:ID="SummaryHeader"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#164E63" ss:Pattern="Solid"/><Borders>${this.excelBorders("#0B6F75")}</Borders></Style>
  <Style ss:ID="SummaryValue"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#15342D"/><Interior ss:Color="#FFF4D9" ss:Pattern="Solid"/><Borders>${this.excelBorders("#F2A11D")}</Borders></Style>
  <Style ss:ID="SheetTitle"><Font ss:FontName="Arial" ss:Size="13" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#164E63" ss:Pattern="Solid"/><Borders>${this.excelBorders("#164E63")}</Borders></Style>
  <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F9D76" ss:Pattern="Solid"/><Borders>${this.excelBorders("#087B5D")}</Borders></Style>
  <Style ss:ID="TextOdd"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders>${this.excelBorders("#CFE3DC")}</Borders></Style>
  <Style ss:ID="TextEven"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="#EEF8F4" ss:Pattern="Solid"/><Borders>${this.excelBorders("#CFE3DC")}</Borders></Style>
  <Style ss:ID="Bar"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#0F9D76"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders>${this.excelBorders("#CFE3DC")}</Borders></Style>
 </Styles>`
  }

  excelBorders(color) {
    return `<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${color}"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${color}"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${color}"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${color}"/>`
  }

  excelSummaryWorksheet(sheets, total, generated) {
    return `<Worksheet ss:Name="Summary">
 <Table>
  <Column ss:Width="220"/><Column ss:Width="95"/><Column ss:Width="95"/><Column ss:Width="320"/>
  <Row ss:Height="34"><Cell ss:MergeAcross="3" ss:StyleID="Title"><Data ss:Type="String">${this.escapeXml(this.districtTitle())} Visible Map Data</Data></Cell></Row>
  <Row ss:Height="24"><Cell ss:MergeAcross="3" ss:StyleID="Subtitle"><Data ss:Type="String">ASA Geoportal | Generated ${this.escapeXml(generated)} | Total visible rows ${total.toLocaleString("en-IN")}</Data></Cell></Row>
  <Row/>
  <Row>
   <Cell ss:StyleID="SummaryHeader"><Data ss:Type="String">Layer</Data></Cell>
   <Cell ss:StyleID="SummaryHeader"><Data ss:Type="String">Rows</Data></Cell>
   <Cell ss:StyleID="SummaryHeader"><Data ss:Type="String">Share</Data></Cell>
   <Cell ss:StyleID="SummaryHeader"><Data ss:Type="String">Visual Bar</Data></Cell>
  </Row>
  ${sheets.map(([name, features]) => this.excelSummaryRow(name, features.length, total)).join("")}
 </Table>
 <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
  <FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane><ActivePane>2</ActivePane>
 </WorksheetOptions>
</Worksheet>`
  }

  excelSummaryRow(name, count, total) {
    const percent = total ? Math.round((count / total) * 100) : 0
    const bar = "|".repeat(Math.max(1, Math.round(percent / 4)))
    return `<Row>
   <Cell ss:StyleID="TextOdd"><Data ss:Type="String">${this.escapeXml(name)}</Data></Cell>
   <Cell ss:StyleID="SummaryValue"><Data ss:Type="Number">${count}</Data></Cell>
   <Cell ss:StyleID="TextOdd"><Data ss:Type="String">${percent}%</Data></Cell>
   <Cell ss:StyleID="Bar"><Data ss:Type="String">${bar}</Data></Cell>
  </Row>`
  }

  exportRows(features) {
    const rows = features.map((feature) => {
      const props = feature.properties || {}
      const [lon, lat] = this.featureLonLat(feature)
      return { ...props, latitude: props.latitude || lat, longitude: props.longitude || lon }
    })
    return rows
  }

  excelAllDataWorksheet(sheets, total) {
    const rows = sheets.flatMap(([name, features]) => {
      return this.exportRows(features).map((row) => ({ layer: name, ...row }))
    })
    const columns = this.exportColumnsFromRows(rows)
    return this.excelRowsWorksheet("All Data", columns, rows, `All Selected Data (${total.toLocaleString("en-IN")} rows)`)
  }

  excelDataWorksheet(name, features) {
    const columns = this.exportColumns(features)
    const rows = this.exportRows(features)
    return this.excelRowsWorksheet(name, columns, rows, `${name} (${features.length.toLocaleString("en-IN")} rows)`)
  }

  excelRowsWorksheet(name, columns, rows, title) {
    return `<Worksheet ss:Name="${this.escapeXml(this.excelSheetName(name))}">
 <Table>
  ${columns.map((column) => `<Column ss:Width="${this.excelColumnWidth(column)}"/>`).join("")}
  <Row ss:Height="27"><Cell ss:MergeAcross="${Math.max(columns.length - 1, 0)}" ss:StyleID="SheetTitle"><Data ss:Type="String">${this.escapeXml(title)}</Data></Cell></Row>
  <Row>${columns.map((column) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${this.escapeXml(this.detailLabel(column))}</Data></Cell>`).join("")}</Row>
  ${rows.map((row, index) => `<Row>${columns.map((column) => this.excelCell(row[column], index % 2 === 0 ? "TextOdd" : "TextEven")).join("")}</Row>`).join("")}
 </Table>
 <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
  <FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane><ActivePane>2</ActivePane>
 </WorksheetOptions>
</Worksheet>`
  }

  excelCell(value, styleId) {
    return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${this.escapeXml(this.detailValue(value))}</Data></Cell>`
  }

  excelColumnWidth(column) {
    if (column === "layer") return 160
    if (["farmer_name", "father_husband_name", "fpc_name", "fco_names", "crop_names", "irrigation_sources"].includes(column)) return 180
    if (["source_sheet", "folder_path", "gis_comment", "varieties"].includes(column)) return 240
    if (["latitude", "longitude", "area_ha", "total_plants", "lgd_code"].includes(column)) return 95
    return 130
  }

  excelSheetName(name) {
    return String(name || "Sheet").replace(/[:\\/?*\[\]]/g, " ").slice(0, 31).trim() || "Sheet"
  }

  exportColumns(features) {
    const preferred = ["activity", "project", "vertical", "fy", "block", "village", "lgd_code", "farmer_id", "farmer_name", "father_husband_name", "fpc_name", "khasra_number", "area_ha", "total_plants", "irrigation_source", "plant_source", "latitude", "longitude"]
    const available = new Set(["latitude", "longitude"])
    features.forEach((feature) => Object.keys(feature.properties || {}).forEach((key) => available.add(key)))
    const ordered = preferred.filter((key) => available.has(key))
    return [...ordered, ...[...available].filter((key) => !ordered.includes(key)).sort()]
  }

  exportColumnsFromRows(rows) {
    const preferred = ["layer", "activity", "project", "vertical", "fy", "block", "village", "lgd_code", "farmer_id", "farmer_name", "father_husband_name", "fpc_name", "khasra_number", "area_ha", "total_plants", "irrigation_source", "plant_source", "latitude", "longitude"]
    const available = new Set()
    rows.forEach((row) => Object.keys(row || {}).forEach((key) => available.add(key)))
    const ordered = preferred.filter((key) => available.has(key))
    return [...ordered, ...[...available].filter((key) => !ordered.includes(key)).sort()]
  }

  featureLonLat(feature) {
    const geometry = feature.geometry || {}
    if (geometry.type === "Point") return geometry.coordinates
    const center = this.featureCenter(feature)
    return center ? [center.lon, center.lat] : [null, null]
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  escapeXml(value) {
    return this.escapeHtml(value).replace(/'/g, "&apos;")
  }

  printMap() {
    if (this.viewMode === "globe") { window.print(); return }
    this.preparePrint()
    // Let the map settle at print size and load tiles before the dialog opens.
    this.map.invalidateSize()
    setTimeout(() => window.print(), 450)
  }

  preparePrint() {
    this.updatePrintTitle()
    // Legend must be visible on the printout even if the on-screen toggle is off.
    this.printLegendWasHidden = this.hasLegendPanelTarget && this.legendPanelTarget.classList.contains("is-hidden")
    if (this.printLegendWasHidden) this.legendPanelTarget.classList.remove("is-hidden")
    if (this.hasBaseMapMenuTarget) this.baseMapMenuTarget.classList.add("is-hidden")
  }

  handleBeforePrint() {
    if (this.viewMode === "globe") return
    this.preparePrint()
    if (this.map) this.map.invalidateSize()
  }

  handleAfterPrint() {
    if (this.printLegendWasHidden && this.hasLegendPanelTarget) {
      this.legendPanelTarget.classList.add("is-hidden")
    }
    this.printLegendWasHidden = false
    if (this.map) setTimeout(() => this.map.invalidateSize(), 120)
  }

  updatePrintTitle() {
    if (!this.hasPrintHeaderTarget) return
    const caption = this.hasMapCaptionTarget && this.mapCaptionTarget.textContent
      ? this.mapCaptionTarget.textContent
      : this.districtTitle()
    const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    const title = document.createElement("strong")
    title.textContent = "ASA Geoportal"
    const sub = document.createElement("span")
    sub.textContent = `${caption} · ${this.regionLabel()} · ${date}`
    this.printHeaderTarget.replaceChildren(title, sub)
  }

  toggleBaseMapMenu() {
    if (this.hasLegendPanelTarget) this.legendPanelTarget.classList.add("is-hidden")
    if (this.hasLegendButtonTarget) {
      this.legendButtonTarget.classList.remove("is-active")
      this.legendButtonTarget.setAttribute("aria-expanded", "false")
    }
    this.baseMapMenuTarget.classList.toggle("is-hidden")
  }

  toggleLegend() {
    if (!this.hasLegendPanelTarget) return
    if (this.hasBaseMapMenuTarget) this.baseMapMenuTarget.classList.add("is-hidden")
    const hidden = this.legendPanelTarget.classList.toggle("is-hidden")
    if (this.hasLegendButtonTarget) {
      this.legendButtonTarget.classList.toggle("is-active", !hidden)
      this.legendButtonTarget.setAttribute("aria-expanded", hidden ? "false" : "true")
    }
  }

  setBaseMap(event) {
    const name = event.currentTarget.dataset.baseMap
    if (!name || name === this.activeBaseMap || !this.baseMaps[name]) return
    this.map.removeLayer(this.baseMaps[this.activeBaseMap])
    this.baseMaps[name].addTo(this.map)
    this.activeBaseMap = name
    this.baseMapMenuTarget.querySelectorAll("[data-base-map]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.baseMap === name)
    })
  }

  focusPreset(event) {
    const preset = event.currentTarget.dataset.preset || "all"
    this.searchInputTarget.value = ""
    this.clearDetails()
    this.explicitEmptyFilters?.clear()
    this.mapItemsVisible = true

    if (preset === "plantation") {
      this.setFilterChecks("project", (input) => ["ABF", "Agrohorti", "ITX"].includes(input.value))
      this.setFilterChecks("fy", () => true)
      this.setFilterChecks("vertical", (input) => input.value === "Plantation")
      this.setFilterChecks("activity", (input) => ["Agro Forestry", "Agrohorti Plantation"].includes(input.value))
      this.clearAreaFilterSelection()
      this.clearBoundaryLayerSelection()
    } else if (preset === "fpo") {
      this.setFilterChecks("project", (input) => input.value === "Agribusiness")
      this.setFilterChecks("fy", () => true)
      this.setFilterChecks("vertical", (input) => input.value === "Agribusiness")
      this.setFilterChecks("activity", (input) => input.value === "FPO Location")
      this.clearAreaFilterSelection()
      this.clearBoundaryLayerSelection()
    } else if (preset === "fco") {
      this.setFilterChecks("project", (input) => input.value === "Agribusiness")
      this.setFilterChecks("fy", () => true)
      this.setFilterChecks("vertical", (input) => input.value === "Agribusiness")
      this.setFilterChecks("activity", (input) => input.value === "FPO Location")
      this.clearAreaFilterSelection()
      this.clearBoundaryLayerSelection()
    } else if (preset === "water") {
      this.setFilterChecks("project", (input) => input.value === "LWRD Interventions")
      this.setFilterChecks("fy", () => true)
      this.setFilterChecks("vertical", (input) => input.value === "WRD")
      this.setFilterChecks("activity", (input) => ["Dugwell", "Stop Dam"].includes(input.value))
      this.clearAreaFilterSelection()
      this.clearBoundaryLayerSelection()
    } else {
      this.setFilterChecks("project", () => false)
      ;["fy", "vertical", "activity"].forEach((group) => this.setFilterChecks(group, () => true))
      this.clearAreaFilterSelection()
      this.clearBoundaryLayerSelection()
    }

    this.updatePresetButtons(preset)
    this.syncBoundarySelectionUi()
    this.syncFilterSummaries()
    this.filterChanged()
    this.syncAdminLayers()
    preset === "all" ? this.applyBounds() : this.fitVisibleMapItems(preset)
  }

  zoomIn() {
    if (this.viewMode === "globe") { this.zoomGlobe(-24); return }
    this.map.zoomIn()
  }

  zoomOut() {
    if (this.viewMode === "globe") { this.zoomGlobe(24); return }
    this.map.zoomOut()
  }

  resetView() {
    this.manualAdminLayers?.clear()
    this.explicitEmptyFilters?.clear()
    this.mapItemsVisible = false
    this.pendingExportSheets = null
    this.setAllFilterChecks(false)
    this.searchInputTarget.value = ""
    if (this.hasMapSearchInputTarget) this.mapSearchInputTarget.value = ""
    if (this.hasLgdInputTarget) this.lgdInputTarget.value = ""
    if (this.hasInterventionToggleTarget) this.interventionToggleTarget.checked = true
    this.bufferPicking = false
    this.routePicking = false
    this.measureActive = false
    this.cropPicking = false
    this.routePoints = []
    this.measurePoints = []
    this.cropPoints = []
    this.bufferLayer?.clearLayers()
    this.routeLayer?.clearLayers()
    this.measurementLayer?.clearLayers()
    this.locationLayer?.clearLayers()
    this.cropLayer?.clearLayers()
    if (this.hasRouteListTarget) this.routeListTarget.replaceChildren()
    if (this.hasRouteStatusTarget) this.updateRouteStatus()
    if (this.hasBufferStatusTarget) this.bufferStatusTarget.textContent = this.t("selectMapLocation")
    this.layerState.district = true
    this.element.querySelectorAll('input[data-layer="district"]').forEach((input) => { input.checked = false })
    this.setAdminLayer("block", false)
    this.setAdminLayer("village", false)
    this.setAdminLayer("villageLabels", false)
    this.setAdminLayer("coverage", false)
    this.syncAdminLayers()
    this.syncBoundarySelectionUi()
    this.syncFilterSummaries()
    this.updateAdminSummary()
    this.updatePresetButtons("reset")
    this.closeControlDropdowns()
    this.clearDetails()
    this.filterChanged()
    this.applyBounds()
    if (this.viewMode === "globe") this.resetGlobeView()
  }

  closeControlDropdowns() {
    this.element.querySelectorAll(".control-panel details[open]").forEach((details) => {
      details.open = false
    })
    if (this.hasBaseMapMenuTarget) this.baseMapMenuTarget.classList.add("is-hidden")
    if (this.hasLegendPanelTarget) this.legendPanelTarget.classList.add("is-hidden")
    if (this.hasLegendButtonTarget) {
      this.legendButtonTarget.classList.remove("is-active")
      this.legendButtonTarget.setAttribute("aria-expanded", "false")
    }
  }

  setFilterChecks(group, matcher) {
    this.filterInputs(group).forEach((input) => {
      input.checked = matcher(input)
    })
  }

  setAllFilterChecks(checked) {
    const groups = ["project", "fy", "vertical", "activity", "block", "villageFilter"]
    groups.forEach((group) => {
      this.filterInputs(group).forEach((input) => {
        input.checked = checked
      })
    })
    this.syncFilterSummaries()
  }

  setDefaultFilterChecks() {
    this.setFilterChecks("project", () => false)
    ;["fy", "vertical", "activity", "block", "villageFilter"].forEach((group) => {
      this.setFilterChecks(group, () => true)
    })
    this.syncBoundarySelectionUi()
    this.syncFilterSummaries()
  }

  clearAreaFilterSelection() {
    this.setFilterChecks("block", () => false)
    this.setFilterChecks("villageFilter", () => false)
    this.setExplicitEmptyFilter("block", false)
    this.setExplicitEmptyFilter("villageFilter", false)
  }

  clearBoundaryLayerSelection() {
    this.setAdminLayer("block", false)
    this.setAdminLayer("village", false)
    this.setAdminLayer("villageLabels", false)
    this.setAdminLayer("coverage", false)
  }

  updatePresetButtons(activePreset) {
    this.element.querySelectorAll(".preset-button").forEach((button) => {
      const active = button.dataset.preset === activePreset
      button.classList.toggle("is-active", active)
      button.setAttribute("aria-pressed", active ? "true" : "false")
    })
  }

  fitVisibleMapItems(preset = "all") {
    if (!this.map || !window.L) return false
    const bounds = window.L.latLngBounds([])
    this.interventionMarkers?.forEach((marker) => {
      if (this.interventionLayer.hasLayer(marker)) bounds.extend(marker.getLatLng())
    })
    this.agribusinessMarkers?.forEach((marker) => {
      if (this.agribusinessLayer.hasLayer(marker)) bounds.extend(marker.getLatLng())
    })
    this.plantationFeatureLayers?.forEach((layer) => {
      if (!this.plantationLayer.hasLayer(layer)) return
      layer.eachLayer((child) => {
        if (child.getBounds) bounds.extend(child.getBounds())
        else if (child.getLatLng) bounds.extend(child.getLatLng())
      })
    })
    if (!bounds.isValid()) return false
    const maxZoom = preset === "plantation" ? 15 : 13
    this.map.fitBounds(bounds, { padding: [54, 54], maxZoom })
    return true
  }

  applyBounds() {
    if (!this.bbox) return
    this.map.fitBounds([[this.bbox[1], this.bbox[0]], [this.bbox[3], this.bbox[2]]], { padding: [24, 24] })
    this.map.setMaxBounds([[this.bbox[1] - 0.18, this.bbox[0] - 0.18], [this.bbox[3] + 0.18, this.bbox[2] + 0.18]])
  }

  fitBbox(b) {
    this.map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] })
  }

  fitCurrentFilterSelection(group) {
    if (!this.map) return
    if (group === "block") {
      this.fitSelectedBlockFeatures() || this.applyBounds()
      return
    }
    if (group === "villageFilter") {
      this.fitSelectedVillageFeatures() || this.fitSelectedBlockFeatures() || this.applyBounds()
      return
    }
    this.fitVisibleMapItems("filter") || this.fitSelectedVillageFeatures() || this.fitSelectedBlockFeatures() || this.applyBounds()
  }

  fitSelectedBlockFeatures() {
    const selected = this.selectedFilter("block")
    if (!selected.total || selected.selected.size === 0 || selected.selected.size === selected.total) return false
    const features = this.blocks.filter((feature) => selected.selected.has(feature.properties.name))
    return this.fitFeatures(features, { maxZoom: features.length === 1 ? 12 : 11 })
  }

  fitSelectedVillageFeatures() {
    const selected = this.selectedFilter("villageFilter")
    if (!selected.total || selected.selected.size === 0 || selected.selected.size === selected.total) return false
    const features = this.villages.filter((feature) => selected.selected.has(this.villageKeyForFeature(feature)))
    return this.fitFeatures(features, { maxZoom: features.length === 1 ? 14 : 12 })
  }

  fitFeatures(features, options = {}) {
    if (!this.map || !window.L || !features?.length) return false
    const bounds = window.L.latLngBounds([])
    features.forEach((feature) => {
      const b = feature?.properties?.bbox || feature?.bbox
      if (b?.length >= 4) bounds.extend([[b[1], b[0]], [b[3], b[2]]])
    })
    if (!bounds.isValid()) return false
    this.map.fitBounds(bounds, {
      padding: options.padding || [48, 48],
      maxZoom: options.maxZoom || 13
    })
    return true
  }

  // ---- Nav active state ----
  trackNav() {
    const sections = ["home", "map"]
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const id = entry.target.id
        this.navLinkTargets.forEach((link) => {
          const nav = link.dataset.nav || link.dataset.view
          const active = (id === "home" && nav === "home") || (id === "map" && nav === this.viewMode)
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

  isCoverageValue(value) {
    if (value === true || value === 1) return true
    return ["yes", "true", "1", "y"].includes(this.norm(value))
  }

  featureLabelPoint(feature) {
    const geometry = feature?.geometry
    const bboxCenter = this.featureCenter(feature)
    if (!geometry) return bboxCenter

    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : (geometry.type === "MultiPolygon" ? geometry.coordinates : [])
    if (!polygons.length) return bboxCenter

    const rings = polygons.map((polygon) => polygon?.[0] || []).filter((ring) => ring.length >= 3)
    const ring = rings.sort((a, b) => Math.abs(this.ringArea(b)) - Math.abs(this.ringArea(a)))[0]
    if (!ring) return bboxCenter

    const centroid = this.ringCentroid(ring)
    if (centroid && this.pointInRing([centroid.lon, centroid.lat], ring)) return centroid

    if (bboxCenter && this.pointInRing([bboxCenter.lon, bboxCenter.lat], ring)) return bboxCenter

    const first = ring.find((point) => Array.isArray(point) && point.length >= 2)
    return first ? { lat: first[1], lon: first[0] } : bboxCenter
  }

  ringArea(ring) {
    let area = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      area += (xj * yi) - (xi * yj)
    }
    return area / 2
  }

  ringCentroid(ring) {
    let areaFactor = 0
    let cx = 0
    let cy = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      const factor = (xj * yi) - (xi * yj)
      areaFactor += factor
      cx += (xj + xi) * factor
      cy += (yj + yi) * factor
    }
    if (!areaFactor) return null
    return { lon: cx / (3 * areaFactor), lat: cy / (3 * areaFactor) }
  }

  pointInRing(point, ring) {
    const [x, y] = point
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      const intersects = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi)
      if (intersects) inside = !inside
    }
    return inside
  }

  featureCenter(feature) {
    const bbox = feature?.properties?.bbox || feature?.bbox
    if (!bbox || bbox.length < 4) return null
    return {
      lat: (bbox[1] + bbox[3]) / 2,
      lon: (bbox[0] + bbox[2]) / 2
    }
  }

  labelCollisionBox(marker) {
    if (!this.map) return null
    const p = this.map.latLngToContainerPoint(marker.getLatLng())
    const label = marker._props?.name || marker._props?.village || ""
    const width = Math.min(120, Math.max(34, String(label).length * 5.8 + 10))
    const height = 14
    return {
      left: p.x - (width / 2),
      right: p.x + (width / 2),
      top: p.y - (height / 2),
      bottom: p.y + (height / 2)
    }
  }

  boxesOverlap(a, b) {
    const gap = 3
    return !(a.right + gap < b.left || b.right + gap < a.left || a.bottom + gap < b.top || b.bottom + gap < a.top)
  }

  fitAdminLayer(layer) {
    if (layer === "district") {
      this.applyBounds()
      return
    }
    if (layer === "block") {
      this.fitSelectedBlockFeatures() || this.fitFeatures(this.blocks, { maxZoom: 11 }) || this.applyBounds()
      return
    }
    if (layer === "village") {
      this.fitSelectedVillageFeatures() || this.fitSelectedBlockFeatures() || this.applyBounds()
      return
    }
    if (layer === "coverage") {
      this.fitFeatures(this.coverageVillageFeatures(), { maxZoom: 12 }) || this.applyBounds()
    }
  }

  hexToNumber(hex) {
    return Number.parseInt(String(hex || "#0f9d76").replace("#", ""), 16) || 0x0f9d76
  }

  caption({ projects, fys, activities, blocks }) {
    const parts = [
      this.filterCaption(blocks, this.districtTitle(), "Blocks"),
      this.filterCaption(fys, "", "FY"),
      this.filterCaption(projects, "", "Projects"),
      this.filterCaption(activities, "", "Interventions")
    ].filter(Boolean)
    return parts.join(" / ")
  }

  filterCaption(filter, allText, pluralText) {
    if (!filter.total) return allText
    if (filter.selected.size === 0) return filter.emptyMeansAll ? allText : `No ${pluralText}`
    if (filter.selected.size === filter.total) return allText
    const values = [...filter.selected]
    return values.length === 1 ? values[0] : `${values.length} ${pluralText}`
  }

  searchText(props, keys) {
    return this.norm(keys.map((key) => this.searchValue(props[key])).join(" "))
  }

  searchValue(value) {
    if (Array.isArray(value)) return value.map((item) => this.searchValue(item)).join(" ")
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, val]) => `${key} ${this.searchValue(val)}`).join(" ")
    }
    return value
  }

  norm(v) {
    return String(v || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim()
  }

  villageKeyForFeature(feature) {
    const props = feature?.properties || {}
    return this.coverageKey(props.block, props.name || props.village, props.lgd_code || props.id)
  }

  villageKeyForProps(props = {}) {
    return this.coverageKey(props.block, props.name || props.village, props.lgd_code)
  }

  villageKeySetHas(keySet, props = {}) {
    if (!keySet) return false
    const exactKey = this.villageKeyForProps(props)
    if (exactKey && keySet.has(exactKey)) return true

    const featureKey = this.villageKeyForFeature({ properties: props })
    if (featureKey && keySet.has(featureKey)) return true

    const nameKey = this.coverageKey(props.block, props.name || props.village)
    if (nameKey && keySet.has(nameKey)) return true
    if (!props.lgd_code && nameKey) {
      const prefix = `${nameKey}|`
      return [...keySet].some((key) => key.startsWith(prefix))
    }
    return false
  }

  coverageKey(block, village, lgdCode = "") {
    if (!block || !village) return null
    const key = `${this.norm(block)}|${this.norm(village)}`
    const code = this.norm(lgdCode)
    return code ? `${key}|${code}` : key
  }

  setStatus(msg) {
    if (this.hasStatusTextTarget) this.statusTextTarget.textContent = msg
  }

  disconnect() {
    if (this.observer) this.observer.disconnect()
    this.stopGlobe()
    window.removeEventListener("resize", this.globeResizeHandler)
    if (this.boundBeforePrint) window.removeEventListener("beforeprint", this.boundBeforePrint)
    if (this.boundAfterPrint) window.removeEventListener("afterprint", this.boundAfterPrint)
    this.detachGlobeEvents()
    if (this.globeRenderer) this.globeRenderer.dispose()
    if (this.map) this.map.remove()
  }
}
