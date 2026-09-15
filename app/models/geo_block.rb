class GeoBlock < ApplicationRecord
  belongs_to :geo_dataset
  has_many :geo_villages, dependent: :nullify
  has_many :geo_interventions, dependent: :nullify
  has_many :geo_agribusiness_locations, dependent: :nullify
  has_many :geo_plantation_plots, dependent: :nullify

  validates :external_id, :name, presence: true

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
      "name" => name,
      "source_name" => source_name,
      "district" => district,
      "bbox" => bbox
    ).compact
  end
end
