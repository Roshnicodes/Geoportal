class GeoPlantationPlot < ApplicationRecord
  belongs_to :geo_dataset
  belongs_to :geo_block, optional: true
  belongs_to :geo_village, optional: true

  validates :external_id, :project, :vertical, :activity, :fy, :longitude, :latitude, presence: true
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }

  def to_geojson_feature
    {
      "type" => "Feature",
      "geometry" => geometry_geojson,
      "properties" => geojson_properties
    }
  end

  private

  def geojson_properties
    properties.merge(
      "id" => external_id,
      "name" => farmer_name.presence || properties["name"],
      "project" => project,
      "vertical" => vertical,
      "activity" => activity,
      "fy" => fy,
      "source_sheet" => source_sheet,
      "farmer_id" => farmer_id,
      "farmer_name" => farmer_name,
      "father_husband_name" => father_husband_name,
      "block" => block_name,
      "village" => village_name,
      "khasra_number" => khasra_number,
      "area_ha" => area_ha&.to_f,
      "total_plants" => total_plants,
      "irrigation_source" => irrigation_source,
      "plant_source" => plant_source,
      "varieties" => varieties
    ).compact
  end
end
