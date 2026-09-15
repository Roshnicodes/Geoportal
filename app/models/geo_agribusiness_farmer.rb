class GeoAgribusinessFarmer < ApplicationRecord
  belongs_to :geo_dataset
  belongs_to :geo_agribusiness_location

  validates :properties, presence: true

  def to_detail_payload
    properties.merge(
      "id" => id,
      "farmer_id" => external_id,
      "family_id" => family_id,
      "farmer_name" => farmer_name,
      "father_husband_name" => father_husband_name,
      "fpc_name" => fpc_name,
      "fy" => fy,
      "block" => block_name,
      "village" => village_name,
      "gram_panchayat" => gram_panchayat,
      "khasra_no" => khasra_no,
      "plot_no" => plot_no,
      "irrigation_source" => irrigation_source,
      "land_type" => land_type,
      "crop_name" => crop_name,
      "crop_type" => crop_type,
      "activity_name" => activity_name
    ).compact
  end
end
