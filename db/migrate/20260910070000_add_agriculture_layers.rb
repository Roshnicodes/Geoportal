class AddAgricultureLayers < ActiveRecord::Migration[8.1]
  def change
    add_column :geo_interventions, :fy, :string
    add_index :geo_interventions, [ :geo_dataset_id, :fy ]

    create_table :geo_agribusiness_locations do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.references :geo_block, foreign_key: true
      t.references :geo_village, foreign_key: true
      t.string :external_id, null: false
      t.string :name, null: false
      t.string :category, null: false
      t.string :project, null: false
      t.string :vertical, null: false
      t.string :activity, null: false
      t.string :fy
      t.string :fpc_name
      t.string :block_name
      t.string :village_name
      t.integer :farmer_count, null: false, default: 0
      t.integer :fpo_holder_count, null: false, default: 0
      t.integer :organic_farmer_count, null: false, default: 0
      t.decimal :longitude, precision: 12, scale: 8, null: false
      t.decimal :latitude, precision: 12, scale: 8, null: false
      t.jsonb :geometry_geojson, null: false, default: {}
      t.jsonb :properties, null: false, default: {}
      t.timestamps
    end
    add_index :geo_agribusiness_locations, [ :geo_dataset_id, :external_id ], unique: true
    add_index :geo_agribusiness_locations, [ :geo_dataset_id, :category ]
    add_index :geo_agribusiness_locations, [ :geo_dataset_id, :fy ]
    add_index :geo_agribusiness_locations, [ :geo_dataset_id, :block_name, :village_name ]
    add_index :geo_agribusiness_locations, [ :geo_dataset_id, :longitude, :latitude ]
    add_index :geo_agribusiness_locations, :properties, using: :gin

    create_table :geo_plantation_plots do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.references :geo_block, foreign_key: true
      t.references :geo_village, foreign_key: true
      t.string :external_id, null: false
      t.string :source_sheet
      t.string :project, null: false
      t.string :vertical, null: false
      t.string :activity, null: false
      t.string :fy, null: false
      t.string :farmer_id
      t.string :farmer_name
      t.string :father_husband_name
      t.string :block_name
      t.string :village_name
      t.string :khasra_number
      t.decimal :area_ha, precision: 12, scale: 4
      t.integer :total_plants
      t.string :irrigation_source
      t.string :plant_source
      t.decimal :longitude, precision: 12, scale: 8, null: false
      t.decimal :latitude, precision: 12, scale: 8, null: false
      t.jsonb :geometry_geojson, null: false, default: {}
      t.jsonb :varieties, null: false, default: {}
      t.jsonb :properties, null: false, default: {}
      t.timestamps
    end
    add_index :geo_plantation_plots, [ :geo_dataset_id, :external_id ], unique: true
    add_index :geo_plantation_plots, [ :geo_dataset_id, :fy ]
    add_index :geo_plantation_plots, [ :geo_dataset_id, :project ]
    add_index :geo_plantation_plots, [ :geo_dataset_id, :block_name, :village_name ]
    add_index :geo_plantation_plots, [ :geo_dataset_id, :longitude, :latitude ]
    add_index :geo_plantation_plots, :varieties, using: :gin
    add_index :geo_plantation_plots, :properties, using: :gin

    add_check_constraint :geo_agribusiness_locations,
      "longitude >= -180 AND longitude <= 180",
      name: "geo_agribusiness_locations_longitude_range"
    add_check_constraint :geo_agribusiness_locations,
      "latitude >= -90 AND latitude <= 90",
      name: "geo_agribusiness_locations_latitude_range"
    add_check_constraint :geo_plantation_plots,
      "longitude >= -180 AND longitude <= 180",
      name: "geo_plantation_plots_longitude_range"
    add_check_constraint :geo_plantation_plots,
      "latitude >= -90 AND latitude <= 90",
      name: "geo_plantation_plots_latitude_range"
  end
end
