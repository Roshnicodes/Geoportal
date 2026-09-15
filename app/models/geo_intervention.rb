class GeoIntervention < ApplicationRecord
  belongs_to :geo_dataset
  belongs_to :geo_block, optional: true
  belongs_to :geo_village, optional: true

  validates :external_id, :project, :vertical, :activity, :longitude, :latitude, presence: true
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }

  def to_geojson_feature
    {
      "type" => "Feature",
      "geometry" => {
        "type" => "Point",
        "coordinates" => [ longitude.to_f, latitude.to_f ]
      },
      "properties" => geojson_properties
    }
  end

  private

  def geojson_properties
    source_properties.merge(
      "id" => external_id,
      "source_id" => source_id,
      "name" => name,
      "project" => project,
      "vertical" => vertical,
      "activity" => activity,
      "theme" => theme,
      "fy" => fy,
      "icon" => icon,
      "block" => block_name,
      "village" => village_name,
      "lgd_code" => lgd_code,
      "inside_boundary" => inside_boundary
    ).compact
  end
end
