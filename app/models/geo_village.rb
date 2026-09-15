class GeoVillage < ApplicationRecord
  belongs_to :geo_dataset
  belongs_to :geo_block, optional: true
  has_many :geo_interventions, dependent: :nullify
  has_many :geo_agribusiness_locations, dependent: :nullify
  has_many :geo_plantation_plots, dependent: :nullify

  validates :external_id, :name, :block_name, presence: true

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
      "block" => block_name,
      "district" => district,
      "lgd_code" => lgd_code,
      "asa_coverage" => asa_coverage,
      "bbox" => bbox
    ).compact
  end
end
