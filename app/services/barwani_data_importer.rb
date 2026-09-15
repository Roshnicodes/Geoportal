require "json"
require "pathname"
require "set"

class BarwaniDataImporter
  DEFAULT_BASE_PATH = Rails.root.join("db/geojson/barwani")

  def initialize(base_path: DEFAULT_BASE_PATH, slug: "barwani")
    @base_path = base_path.is_a?(Pathname) ? base_path : Pathname.new(base_path.to_s)
    @slug = slug
  end

  def import!
    manifest = read_json("manifest.json")
    blocks = read_json("blocks.geojson").fetch("features")
    villages = read_json("villages.geojson").fetch("features")
    interventions = read_json("poi_wrd_interventions.geojson").fetch("features")
    agribusiness_locations = read_features("agribusiness_locations.geojson")
    plantation_plots = read_features("agrohorti_plantations.geojson")
    coverage_keys = (interventions + agribusiness_locations + plantation_plots).filter_map do |feature|
      coverage_key(feature.dig("properties", "block"), feature.dig("properties", "village"))
    end.to_set

    ApplicationRecord.transaction do
      dataset = GeoDataset.find_or_initialize_by(slug: @slug)
      crs = manifest.fetch("coordinate_reference_system", {})
      dataset.assign_attributes(
        name: manifest.fetch("district", "Barwani"),
        crs_authority: crs.fetch("authority", "EPSG:4326"),
        crs_name: crs.fetch("name", "WGS 84"),
        crs_unit: crs.fetch("unit", "Degree"),
        bbox: manifest.fetch("bbox"),
        counts: manifest.fetch("counts", {}),
        source_metadata: sanitized_metadata(manifest)
      )
      dataset.save!

      dataset.geo_plantation_plots.delete_all
      dataset.geo_agribusiness_farmers.delete_all
      dataset.geo_agribusiness_locations.delete_all
      dataset.geo_interventions.delete_all
      dataset.geo_villages.delete_all
      dataset.geo_blocks.delete_all

      block_index = import_blocks(dataset, blocks)
      village_index = import_villages(dataset, villages, block_index, coverage_keys)
      import_interventions(dataset, interventions, block_index, village_index)
      import_agribusiness_locations(dataset, agribusiness_locations, block_index, village_index)
      import_plantation_plots(dataset, plantation_plots, block_index, village_index)

      {
        dataset: dataset.slug,
        blocks: dataset.geo_blocks.count,
        villages: dataset.geo_villages.count,
        interventions: dataset.geo_interventions.count,
        agribusiness_locations: dataset.geo_agribusiness_locations.count,
        plantation_plots: dataset.geo_plantation_plots.count
      }
    end
  end

  private

  def read_json(filename)
    JSON.parse(@base_path.join(filename).read)
  end

  def read_features(filename)
    path = @base_path.join(filename)
    return [] unless path.exist?

    JSON.parse(path.read).fetch("features")
  end

  def sanitized_metadata(manifest)
    manifest.except("files", "source_files").tap do |metadata|
      metadata["coordinate_reference_system"] = metadata.fetch("coordinate_reference_system", {}).except("source_prj")
    end
  end

  def import_blocks(dataset, features)
    features.each_with_object({}) do |feature, index|
      props = feature.fetch("properties")
      block = dataset.geo_blocks.create!(
        external_id: props.fetch("id"),
        name: props.fetch("name"),
        source_name: props["source_name"],
        district: props["district"],
        bbox: props.fetch("bbox"),
        geometry_geojson: feature.fetch("geometry"),
        properties: props
      )
      index[normalize_key(block.name)] = block
    end
  end

  def import_villages(dataset, features, block_index, coverage_keys)
    features.each_with_object({}) do |feature, index|
      props = feature.fetch("properties")
      block_name = props.fetch("block")
      village = dataset.geo_villages.create!(
        geo_block: block_index[normalize_key(block_name)],
        external_id: props.fetch("id"),
        name: props.fetch("name"),
        block_name: block_name,
        district: props["district"],
        lgd_code: props["lgd_code"]&.to_s,
        asa_coverage: coverage_keys.include?(coverage_key(block_name, props.fetch("name"))),
        bbox: props.fetch("bbox"),
        geometry_geojson: feature.fetch("geometry"),
        properties: props
      )
      index[coverage_key(village.block_name, village.name)] = village
    end
  end

  def import_interventions(dataset, features, block_index, village_index)
    features.each do |feature|
      props = feature.fetch("properties")
      lon, lat = feature.dig("geometry", "coordinates")
      block = block_index[normalize_key(props["block"])]
      village = village_index[coverage_key(props["block"], props["village"])]

      dataset.geo_interventions.create!(
        geo_block: block,
        geo_village: village,
        external_id: props.fetch("id"),
        source_id: props["source_id"]&.to_s,
        name: props["name"],
        project: props.fetch("project", props.fetch("theme", "Unmapped Project")),
        vertical: props.fetch("vertical", "Unmapped"),
        activity: props.fetch("activity"),
        fy: props["fy"],
        theme: props["theme"],
        icon: props["icon"],
        block_name: props["block"],
        village_name: props["village"],
        lgd_code: props["lgd_code"]&.to_s,
        longitude: lon,
        latitude: lat,
        inside_boundary: props["inside_boundary"] || false,
        source_properties: props
      )
    end
  end

  def import_agribusiness_locations(dataset, features, block_index, village_index)
    features.each do |feature|
      props = feature.fetch("properties")
      farmer_rows = props.fetch("farmers", [])
      public_props = props.except("farmers")
      lon, lat = feature.dig("geometry", "coordinates")
      block = block_index[normalize_key(props["block"])]
      village = village_index[coverage_key(props["block"], props["village"])]

      location = dataset.geo_agribusiness_locations.create!(
        geo_block: block,
        geo_village: village,
        external_id: props.fetch("id"),
        name: props.fetch("name"),
        category: props.fetch("category", "FPO Location"),
        project: props.fetch("project", "Agribusiness"),
        vertical: props.fetch("vertical", "Agribusiness"),
        activity: props.fetch("activity", "FPO Location"),
        fy: props["fy"],
        fpc_name: props["fpc_name"],
        block_name: props["block"],
        village_name: props["village"],
        farmer_count: props["farmer_count"] || 0,
        fpo_holder_count: props["fpo_holder_count"] || 0,
        organic_farmer_count: props["organic_farmer_count"] || 0,
        longitude: lon,
        latitude: lat,
        geometry_geojson: feature.fetch("geometry"),
        properties: public_props
      )
      import_agribusiness_farmers(dataset, location, farmer_rows)
    end
  end

  def import_agribusiness_farmers(dataset, location, farmer_rows)
    farmer_rows.each do |row|
      dataset.geo_agribusiness_farmers.create!(
        geo_agribusiness_location: location,
        external_id: row["farmer_id"],
        family_id: row["family_id"],
        farmer_name: row["farmer_name"],
        father_husband_name: row["father_husband_name"],
        fpc_name: row["fpc_name"] || location.fpc_name,
        fy: location.fy,
        block_name: row["block"] || location.block_name,
        village_name: row["village"] || location.village_name,
        gram_panchayat: row["gram_panchayat"],
        khasra_no: row["khasra_no"],
        plot_no: row["plot_no"],
        irrigation_source: row["irrigation_source"],
        land_type: row["land_type"],
        crop_name: row["crop_name"],
        crop_type: row["crop_type"],
        activity_name: row["activity_name"],
        properties: row
      )
    end
  end

  def import_plantation_plots(dataset, features, block_index, village_index)
    features.each do |feature|
      props = feature.fetch("properties")
      lon = props["longitude"] || geometry_center(feature.fetch("geometry")).first
      lat = props["latitude"] || geometry_center(feature.fetch("geometry")).last
      block = block_index[normalize_key(props["block"])]
      village = village_index[coverage_key(props["block"], props["village"])]

      dataset.geo_plantation_plots.create!(
        geo_block: block,
        geo_village: village,
        external_id: props.fetch("id"),
        source_sheet: props["source_sheet"],
        project: props.fetch("project", "Agrohorti"),
        vertical: props.fetch("vertical", "Plantation"),
        activity: props.fetch("activity", "Agrohorti Plantation"),
        fy: props.fetch("fy"),
        farmer_id: props["farmer_id"],
        farmer_name: props["farmer_name"],
        father_husband_name: props["father_husband_name"],
        block_name: props["block"],
        village_name: props["village"],
        khasra_number: props["khasra_number"],
        area_ha: props["area_ha"],
        total_plants: props["total_plants"],
        irrigation_source: props["irrigation_source"],
        plant_source: props["plant_source"],
        longitude: lon,
        latitude: lat,
        geometry_geojson: feature.fetch("geometry"),
        varieties: props["varieties"] || {},
        properties: props
      )
    end
  end

  def coverage_key(block, village)
    return if block.blank? || village.blank?

    "#{normalize_key(block)}|#{normalize_key(village)}"
  end

  def normalize_key(value)
    value.to_s.downcase.squish
  end

  def geometry_center(geometry)
    coords = geometry_coordinates(geometry)
    [
      coords.sum { |point| point.first.to_f } / coords.size,
      coords.sum { |point| point.last.to_f } / coords.size
    ]
  end

  def geometry_coordinates(geometry)
    case geometry["type"]
    when "Point"
      [ geometry["coordinates"] ]
    when "Polygon"
      geometry["coordinates"].flatten(1)
    when "MultiPolygon"
      geometry["coordinates"].flatten(2)
    else
      []
    end
  end
end
