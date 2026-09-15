require "test_helper"

class Api::Barwani::LayersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @dataset = GeoDataset.create!(
      slug: "barwani",
      name: "Barwani",
      bbox: [ 74.43, 21.36, 75.63, 22.13 ],
      counts: { "blocks" => 1, "villages" => 1, "interventions" => 1, "agribusiness_locations" => 1, "plantation_plots" => 1, "map_items" => 3 },
      source_metadata: {
        "projects" => { "LWRD Interventions" => 1, "Agribusiness" => 1, "Agrohorti" => 1 },
        "activity_counts" => { "Dugwell" => 1, "FPO Location" => 1, "Agrohorti Plantation" => 1 },
        "fy_counts" => { "2026-27" => 2 },
        "source_files" => { "blocks" => "/private/source.zip" },
        "coordinate_reference_system" => { "source_prj" => "PRIVATE PRJ" }
      }
    )
    @block = @dataset.geo_blocks.create!(
      external_id: "BLK-01",
      name: "Rajpur",
      district: "Barwani",
      bbox: [ 74.7, 21.6, 75.1, 22.0 ],
      geometry_geojson: polygon,
      properties: { "type" => "Block Boundary" }
    )
    @village = @dataset.geo_villages.create!(
      geo_block: @block,
      external_id: "VIL-001",
      name: "Sample Village",
      block_name: "Rajpur",
      district: "Barwani",
      asa_coverage: true,
      bbox: [ 74.8, 21.7, 74.9, 21.8 ],
      geometry_geojson: polygon,
      properties: { "type" => "Village Boundary" }
    )
    @dataset.geo_interventions.create!(
      geo_block: @block,
      geo_village: @village,
      external_id: "POI-001",
      name: "Dugwell",
      project: "LWRD Interventions",
      vertical: "WRD",
      activity: "Dugwell",
      theme: "Water Resources",
      icon: "well",
      block_name: "Rajpur",
      village_name: "Sample Village",
      longitude: 74.85,
      latitude: 21.75,
      inside_boundary: true
    )
    @agribusiness_location = @dataset.geo_agribusiness_locations.create!(
      geo_block: @block,
      geo_village: @village,
      external_id: "AGB-001",
      name: "Sample FPC",
      category: "FPO Location",
      project: "Agribusiness",
      vertical: "Agribusiness",
      activity: "FPO Location",
      fy: "2026-27",
      fpc_name: "Sample FPC",
      block_name: "Rajpur",
      village_name: "Sample Village",
      farmer_count: 42,
      fpo_holder_count: 20,
      organic_farmer_count: 18,
      longitude: 74.86,
      latitude: 21.76,
      geometry_geojson: { "type" => "Point", "coordinates" => [ 74.86, 21.76 ] },
      properties: { "farmer_detail_count" => 1, "location_basis" => "Village centroid" }
    )
    @dataset.geo_agribusiness_farmers.create!(
      geo_agribusiness_location: @agribusiness_location,
      external_id: "FARM-001",
      family_id: "FAM-001",
      farmer_name: "Sample Farmer",
      father_husband_name: "Sample Father",
      fpc_name: "Sample FPC",
      fy: "2026-27",
      block_name: "Rajpur",
      village_name: "Sample Village",
      gram_panchayat: "Sample GP",
      khasra_no: "45/2",
      irrigation_source: "Well",
      land_type: "Irrigated Land",
      crop_name: "Cotton",
      activity_name: "No Activity",
      properties: {
        "farmer_id" => "FARM-001",
        "farmer_name" => "Sample Farmer",
        "father_husband_name" => "Sample Father",
        "is_fpo_holder" => "Yes",
        "is_organic" => "Yes"
      }
    )
    @dataset.geo_plantation_plots.create!(
      geo_block: @block,
      geo_village: @village,
      external_id: "PLT-001",
      source_sheet: "Plantation_2026-27",
      project: "Agrohorti",
      vertical: "Plantation",
      activity: "Agrohorti Plantation",
      fy: "2026-27",
      farmer_name: "Sample Farmer",
      father_husband_name: "Sample Father",
      block_name: "Rajpur",
      village_name: "Sample Village",
      khasra_number: "12/1",
      area_ha: 0.5,
      total_plants: 80,
      irrigation_source: "Well",
      longitude: 74.85,
      latitude: 21.75,
      geometry_geojson: polygon,
      varieties: { "Kesar" => 50, "Langda" => 30 }
    )
  end

  test "manifest exposes API paths without private source metadata" do
    get "/api/barwani/manifest.json"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "barwani", body["slug"]
    assert_equal "Barwani", body["name"]
    assert_equal "Barwani", body["district"]
    assert_equal "/api/barwani/blocks.geojson", body.dig("files", "blocks")
    assert_equal "/api/barwani/agrohorti_plantations.geojson", body.dig("files", "plantations")
    assert_equal 3, body.dig("counts", "map_items")
    assert_equal 2, body.dig("fy_counts", "2026-27")
    assert_equal "EPSG:4326", body.dig("coordinate_reference_system", "authority")
    assert_nil body["source_files"]
    assert_nil body.dig("coordinate_reference_system", "source_prj")
  end

  test "manifest can be served for any imported district slug" do
    GeoDataset.create!(
      slug: "dhar",
      name: "Dhar",
      bbox: [ 74.2, 21.9, 75.5, 23.0 ],
      counts: { "blocks" => 0, "villages" => 0, "map_items" => 0 }
    )

    get "/api/dhar/manifest.json"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "dhar", body["slug"]
    assert_equal "Dhar", body["district"]
    assert_equal "/api/dhar/blocks.geojson", body.dig("files", "blocks")
  end

  test "blocks endpoint returns geojson feature collection" do
    get "/api/barwani/blocks.geojson"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "FeatureCollection", body["type"]
    assert_equal 1, body["features"].size
    assert_equal "Rajpur", body.dig("features", 0, "properties", "name")
  end

  test "agribusiness endpoint returns fpo aggregate locations" do
    get "/api/barwani/agribusiness_locations.geojson"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "FeatureCollection", body["type"]
    assert_equal "FPO Location", body.dig("features", 0, "properties", "activity")
    assert_equal 42, body.dig("features", 0, "properties", "farmer_count")
    assert_nil body.dig("features", 0, "properties", "farmers")
  end

  test "agribusiness farmer endpoint returns selected fpo farmer rows" do
    get "/api/barwani/agribusiness_locations/AGB-001/farmers.json"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "Sample FPC", body.dig("location", "name")
    assert_equal 1, body["farmers"].size
    assert_equal "Sample Farmer", body.dig("farmers", 0, "farmer_name")
    assert_equal "45/2", body.dig("farmers", 0, "khasra_no")
    assert_nil body.dig("farmers", 0, "mobile_no")
  end

  test "plantation endpoint returns agrohorti plot details" do
    get "/api/barwani/agrohorti_plantations.geojson"

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "FeatureCollection", body["type"]
    assert_equal "Agrohorti Plantation", body.dig("features", 0, "properties", "activity")
    assert_equal({ "Kesar" => 50, "Langda" => 30 }, body.dig("features", 0, "properties", "varieties"))
  end

  private

  def polygon
    {
      "type" => "Polygon",
      "coordinates" => [
        [
          [ 74.7, 21.7 ],
          [ 74.9, 21.7 ],
          [ 74.9, 21.9 ],
          [ 74.7, 21.9 ],
          [ 74.7, 21.7 ]
        ]
      ]
    }
  end
end
