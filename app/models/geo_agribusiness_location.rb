class GeoAgribusinessLocation < ApplicationRecord
  belongs_to :geo_dataset
  belongs_to :geo_block, optional: true
  belongs_to :geo_village, optional: true
  has_many :geo_agribusiness_farmers, dependent: :destroy

  validates :external_id, :name, :category, :project, :vertical, :activity, :longitude, :latitude, presence: true
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }

  def to_geojson_feature
    {
      "type" => "Feature",
      "geometry" => geometry_geojson.presence || {
        "type" => "Point",
        "coordinates" => [ longitude.to_f, latitude.to_f ]
      },
      "properties" => geojson_properties
    }
  end

  private

  def geojson_properties
    properties.merge(
      "id" => external_id,
      "name" => name,
      "category" => category,
      "project" => project,
      "vertical" => vertical,
      "activity" => activity,
      "fy" => fy,
      "fpc_name" => fpc_name,
      "block" => block_name,
      "village" => village_name,
      "farmer_count" => farmer_count,
      "farmer_detail_count" => properties["farmer_detail_count"] || farmer_count,
      "fpo_holder_count" => fpo_holder_count,
      "organic_farmer_count" => organic_farmer_count
    ).merge(farmer_summary_properties).compact
  end

  def farmer_summary_properties
    rows = geo_agribusiness_farmers.map(&:to_detail_payload)
    return {} if rows.empty?

    production_qtl = sum_numeric(rows, "production_qtl")
    payment_bonus = sum_numeric_by_pattern(rows, /payment|bonus/i)
    approx_income = sum_numeric(rows, "approx_income")
    fco_names = unique_values(rows, "fco_name")
    ics_names = unique_values(rows, "ics_team_name")
    crop_names = tally_values(rows.filter_map { |row| row["crop_name"] })

    {
      "fco_names" => fco_names,
      "fco_count" => fco_names.length,
      "ics_team_names" => ics_names,
      "ics_team_count" => ics_names.length,
      "covered_village_count" => unique_values(rows, "village").length,
      "crop_names" => crop_names,
      "production_qtl" => production_qtl.positive? ? production_qtl : nil,
      "payment_bonus" => payment_bonus.positive? ? payment_bonus : nil,
      "approx_income_total" => approx_income.positive? ? approx_income : nil
    }
  end

  def unique_values(rows, key)
    rows.filter_map { |row| row[key].presence }.uniq.sort
  end

  def tally_values(values)
    values.tally.sort_by { |_name, count| -count }.to_h
  end

  def sum_numeric(rows, key)
    rows.sum { |row| numeric_value(row[key]) || 0 }
  end

  def sum_numeric_by_pattern(rows, pattern)
    rows.sum do |row|
      row.sum do |key, value|
        pattern.match?(key.to_s) ? numeric_value(value).to_f : 0
      end
    end
  end

  def numeric_value(value)
    Float(value.to_s.delete(","), exception: false)
  end
end
