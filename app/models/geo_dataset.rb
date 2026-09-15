class GeoDataset < ApplicationRecord
  has_many :geo_blocks, dependent: :destroy
  has_many :geo_villages, dependent: :destroy
  has_many :geo_interventions, dependent: :destroy
  has_many :geo_agribusiness_locations, dependent: :destroy
  has_many :geo_agribusiness_farmers, dependent: :destroy
  has_many :geo_plantation_plots, dependent: :destroy

  validates :slug, presence: true, uniqueness: true
  validates :name, :crs_authority, :crs_name, :crs_unit, presence: true

  def manifest_payload
    exposed_metadata = source_metadata.slice(
      "activity_counts",
      "fy_counts",
      "poi_block_counts",
      "projects",
      "verticals",
      "village_block_counts"
    )

    exposed_metadata.merge(
      "slug" => slug,
      "name" => name,
      "district" => name,
      "state" => source_metadata["state"] || source_metadata["state_name"],
      "bbox" => bbox,
      "counts" => counts,
      "files" => {
        "blocks" => "/api/#{slug}/blocks.geojson",
        "villages" => "/api/#{slug}/villages.geojson",
        "pois" => "/api/#{slug}/poi_wrd_interventions.geojson",
        "agribusiness" => "/api/#{slug}/agribusiness_locations.geojson",
        "plantations" => "/api/#{slug}/agrohorti_plantations.geojson"
      },
      "coordinate_reference_system" => coordinate_reference_system_payload
    )
  end

  def coordinate_reference_system_payload
    {
      "authority" => crs_authority,
      "name" => crs_name,
      "unit" => crs_unit,
      "globe_projection" => "WGS84 longitude/latitude converted to spherical globe coordinates"
    }
  end
end
