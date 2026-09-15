# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_09_10_110000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "postgis"

  create_table "geo_agribusiness_farmers", force: :cascade do |t|
    t.string "activity_name"
    t.string "block_name"
    t.datetime "created_at", null: false
    t.string "crop_name"
    t.string "crop_type"
    t.string "external_id"
    t.string "family_id"
    t.string "farmer_name"
    t.string "father_husband_name"
    t.string "fpc_name"
    t.string "fy"
    t.bigint "geo_agribusiness_location_id", null: false
    t.bigint "geo_dataset_id", null: false
    t.string "gram_panchayat"
    t.string "irrigation_source"
    t.string "khasra_no"
    t.string "land_type"
    t.string "plot_no"
    t.jsonb "properties", default: {}, null: false
    t.datetime "updated_at", null: false
    t.string "village_name"
    t.index ["geo_agribusiness_location_id", "farmer_name"], name: "idx_on_geo_agribusiness_location_id_farmer_name_d5951f5673"
    t.index ["geo_agribusiness_location_id"], name: "index_geo_agribusiness_farmers_on_geo_agribusiness_location_id"
    t.index ["geo_dataset_id", "block_name", "village_name"], name: "idx_on_geo_dataset_id_block_name_village_name_eced8a9151"
    t.index ["geo_dataset_id", "external_id"], name: "idx_on_geo_dataset_id_external_id_2269ebe8ed"
    t.index ["geo_dataset_id", "fy"], name: "index_geo_agribusiness_farmers_on_geo_dataset_id_and_fy"
    t.index ["geo_dataset_id"], name: "index_geo_agribusiness_farmers_on_geo_dataset_id"
    t.index ["properties"], name: "index_geo_agribusiness_farmers_on_properties", using: :gin
  end

  create_table "geo_agribusiness_locations", force: :cascade do |t|
    t.string "activity", null: false
    t.string "block_name"
    t.string "category", null: false
    t.datetime "created_at", null: false
    t.string "external_id", null: false
    t.integer "farmer_count", default: 0, null: false
    t.string "fpc_name"
    t.integer "fpo_holder_count", default: 0, null: false
    t.string "fy"
    t.bigint "geo_block_id"
    t.bigint "geo_dataset_id", null: false
    t.bigint "geo_village_id"
    t.jsonb "geometry_geojson", default: {}, null: false
    t.decimal "latitude", precision: 12, scale: 8, null: false
    t.decimal "longitude", precision: 12, scale: 8, null: false
    t.string "name", null: false
    t.integer "organic_farmer_count", default: 0, null: false
    t.string "project", null: false
    t.jsonb "properties", default: {}, null: false
    t.datetime "updated_at", null: false
    t.string "vertical", null: false
    t.string "village_name"
    t.index ["geo_block_id"], name: "index_geo_agribusiness_locations_on_geo_block_id"
    t.index ["geo_dataset_id", "block_name", "village_name"], name: "idx_on_geo_dataset_id_block_name_village_name_c8790d4ce1"
    t.index ["geo_dataset_id", "category"], name: "idx_on_geo_dataset_id_category_78f57314ef"
    t.index ["geo_dataset_id", "external_id"], name: "idx_on_geo_dataset_id_external_id_31f7ddd3d8", unique: true
    t.index ["geo_dataset_id", "fy"], name: "index_geo_agribusiness_locations_on_geo_dataset_id_and_fy"
    t.index ["geo_dataset_id", "longitude", "latitude"], name: "idx_on_geo_dataset_id_longitude_latitude_6763bcee6c"
    t.index ["geo_dataset_id"], name: "index_geo_agribusiness_locations_on_geo_dataset_id"
    t.index ["geo_village_id"], name: "index_geo_agribusiness_locations_on_geo_village_id"
    t.index ["properties"], name: "index_geo_agribusiness_locations_on_properties", using: :gin
    t.check_constraint "latitude >= '-90'::integer::numeric AND latitude <= 90::numeric", name: "geo_agribusiness_locations_latitude_range"
    t.check_constraint "longitude >= '-180'::integer::numeric AND longitude <= 180::numeric", name: "geo_agribusiness_locations_longitude_range"
  end

  create_table "geo_blocks", force: :cascade do |t|
    t.jsonb "bbox", default: [], null: false
    t.datetime "created_at", null: false
    t.string "district"
    t.string "external_id", null: false
    t.bigint "geo_dataset_id", null: false
    t.jsonb "geometry_geojson", default: {}, null: false
    t.string "name", null: false
    t.jsonb "properties", default: {}, null: false
    t.string "source_name"
    t.datetime "updated_at", null: false
    t.index ["geo_dataset_id", "external_id"], name: "index_geo_blocks_on_geo_dataset_id_and_external_id", unique: true
    t.index ["geo_dataset_id", "name"], name: "index_geo_blocks_on_geo_dataset_id_and_name"
    t.index ["geo_dataset_id"], name: "index_geo_blocks_on_geo_dataset_id"
    t.index ["properties"], name: "index_geo_blocks_on_properties", using: :gin
  end

  create_table "geo_datasets", force: :cascade do |t|
    t.jsonb "bbox", default: [], null: false
    t.jsonb "counts", default: {}, null: false
    t.datetime "created_at", null: false
    t.string "crs_authority", default: "EPSG:4326", null: false
    t.string "crs_name", default: "WGS 84", null: false
    t.string "crs_unit", default: "Degree", null: false
    t.string "name", null: false
    t.string "slug", null: false
    t.jsonb "source_metadata", default: {}, null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_geo_datasets_on_slug", unique: true
  end

  create_table "geo_interventions", force: :cascade do |t|
    t.string "activity", null: false
    t.string "block_name"
    t.datetime "created_at", null: false
    t.string "external_id", null: false
    t.string "fy"
    t.bigint "geo_block_id"
    t.bigint "geo_dataset_id", null: false
    t.bigint "geo_village_id"
    t.string "icon"
    t.boolean "inside_boundary", default: false, null: false
    t.decimal "latitude", precision: 12, scale: 8, null: false
    t.string "lgd_code"
    t.decimal "longitude", precision: 12, scale: 8, null: false
    t.string "name"
    t.string "project", null: false
    t.string "source_id"
    t.jsonb "source_properties", default: {}, null: false
    t.string "theme"
    t.datetime "updated_at", null: false
    t.string "vertical", null: false
    t.string "village_name"
    t.index ["geo_block_id"], name: "index_geo_interventions_on_geo_block_id"
    t.index ["geo_dataset_id", "activity"], name: "index_geo_interventions_on_geo_dataset_id_and_activity"
    t.index ["geo_dataset_id", "block_name", "village_name"], name: "idx_on_geo_dataset_id_block_name_village_name_5cd4a30f79"
    t.index ["geo_dataset_id", "external_id"], name: "index_geo_interventions_on_geo_dataset_id_and_external_id", unique: true
    t.index ["geo_dataset_id", "fy"], name: "index_geo_interventions_on_geo_dataset_id_and_fy"
    t.index ["geo_dataset_id", "longitude", "latitude"], name: "idx_on_geo_dataset_id_longitude_latitude_e2e354d277"
    t.index ["geo_dataset_id", "project"], name: "index_geo_interventions_on_geo_dataset_id_and_project"
    t.index ["geo_dataset_id", "vertical"], name: "index_geo_interventions_on_geo_dataset_id_and_vertical"
    t.index ["geo_dataset_id"], name: "index_geo_interventions_on_geo_dataset_id"
    t.index ["geo_village_id"], name: "index_geo_interventions_on_geo_village_id"
    t.index ["source_properties"], name: "index_geo_interventions_on_source_properties", using: :gin
    t.check_constraint "latitude >= '-90'::integer::numeric AND latitude <= 90::numeric", name: "geo_interventions_latitude_range"
    t.check_constraint "longitude >= '-180'::integer::numeric AND longitude <= 180::numeric", name: "geo_interventions_longitude_range"
  end

  create_table "geo_plantation_plots", force: :cascade do |t|
    t.string "activity", null: false
    t.decimal "area_ha", precision: 12, scale: 4
    t.string "block_name"
    t.datetime "created_at", null: false
    t.string "external_id", null: false
    t.string "farmer_id"
    t.string "farmer_name"
    t.string "father_husband_name"
    t.string "fy", null: false
    t.bigint "geo_block_id"
    t.bigint "geo_dataset_id", null: false
    t.bigint "geo_village_id"
    t.jsonb "geometry_geojson", default: {}, null: false
    t.string "irrigation_source"
    t.string "khasra_number"
    t.decimal "latitude", precision: 12, scale: 8, null: false
    t.decimal "longitude", precision: 12, scale: 8, null: false
    t.string "plant_source"
    t.string "project", null: false
    t.jsonb "properties", default: {}, null: false
    t.string "source_sheet"
    t.integer "total_plants"
    t.datetime "updated_at", null: false
    t.jsonb "varieties", default: {}, null: false
    t.string "vertical", null: false
    t.string "village_name"
    t.index ["geo_block_id"], name: "index_geo_plantation_plots_on_geo_block_id"
    t.index ["geo_dataset_id", "block_name", "village_name"], name: "idx_on_geo_dataset_id_block_name_village_name_e0dc002750"
    t.index ["geo_dataset_id", "external_id"], name: "index_geo_plantation_plots_on_geo_dataset_id_and_external_id", unique: true
    t.index ["geo_dataset_id", "fy"], name: "index_geo_plantation_plots_on_geo_dataset_id_and_fy"
    t.index ["geo_dataset_id", "longitude", "latitude"], name: "idx_on_geo_dataset_id_longitude_latitude_fec77e31d1"
    t.index ["geo_dataset_id", "project"], name: "index_geo_plantation_plots_on_geo_dataset_id_and_project"
    t.index ["geo_dataset_id"], name: "index_geo_plantation_plots_on_geo_dataset_id"
    t.index ["geo_village_id"], name: "index_geo_plantation_plots_on_geo_village_id"
    t.index ["properties"], name: "index_geo_plantation_plots_on_properties", using: :gin
    t.index ["varieties"], name: "index_geo_plantation_plots_on_varieties", using: :gin
    t.check_constraint "latitude >= '-90'::integer::numeric AND latitude <= 90::numeric", name: "geo_plantation_plots_latitude_range"
    t.check_constraint "longitude >= '-180'::integer::numeric AND longitude <= 180::numeric", name: "geo_plantation_plots_longitude_range"
  end

  create_table "geo_villages", force: :cascade do |t|
    t.boolean "asa_coverage", default: false, null: false
    t.jsonb "bbox", default: [], null: false
    t.string "block_name", null: false
    t.datetime "created_at", null: false
    t.string "district"
    t.string "external_id", null: false
    t.bigint "geo_block_id"
    t.bigint "geo_dataset_id", null: false
    t.jsonb "geometry_geojson", default: {}, null: false
    t.string "lgd_code"
    t.string "name", null: false
    t.jsonb "properties", default: {}, null: false
    t.datetime "updated_at", null: false
    t.index ["geo_block_id"], name: "index_geo_villages_on_geo_block_id"
    t.index ["geo_dataset_id", "asa_coverage"], name: "index_geo_villages_on_geo_dataset_id_and_asa_coverage"
    t.index ["geo_dataset_id", "block_name", "name"], name: "index_geo_villages_on_geo_dataset_id_and_block_name_and_name"
    t.index ["geo_dataset_id", "external_id"], name: "index_geo_villages_on_geo_dataset_id_and_external_id", unique: true
    t.index ["geo_dataset_id"], name: "index_geo_villages_on_geo_dataset_id"
    t.index ["lgd_code"], name: "index_geo_villages_on_lgd_code"
    t.index ["properties"], name: "index_geo_villages_on_properties", using: :gin
  end

  add_foreign_key "geo_agribusiness_farmers", "geo_agribusiness_locations"
  add_foreign_key "geo_agribusiness_farmers", "geo_datasets"
  add_foreign_key "geo_agribusiness_locations", "geo_blocks"
  add_foreign_key "geo_agribusiness_locations", "geo_datasets"
  add_foreign_key "geo_agribusiness_locations", "geo_villages"
  add_foreign_key "geo_blocks", "geo_datasets"
  add_foreign_key "geo_interventions", "geo_blocks"
  add_foreign_key "geo_interventions", "geo_datasets"
  add_foreign_key "geo_interventions", "geo_villages"
  add_foreign_key "geo_plantation_plots", "geo_blocks"
  add_foreign_key "geo_plantation_plots", "geo_datasets"
  add_foreign_key "geo_plantation_plots", "geo_villages"
  add_foreign_key "geo_villages", "geo_blocks"
  add_foreign_key "geo_villages", "geo_datasets"
end
