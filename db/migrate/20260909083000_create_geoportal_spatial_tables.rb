class CreateGeoportalSpatialTables < ActiveRecord::Migration[8.1]
  def change
    enable_extension "postgis" unless extension_enabled?("postgis")

    create_table :geo_datasets do |t|
      t.string :slug, null: false
      t.string :name, null: false
      t.string :crs_authority, null: false, default: "EPSG:4326"
      t.string :crs_name, null: false, default: "WGS 84"
      t.string :crs_unit, null: false, default: "Degree"
      t.jsonb :bbox, null: false, default: []
      t.jsonb :counts, null: false, default: {}
      t.jsonb :source_metadata, null: false, default: {}
      t.timestamps
    end
    add_index :geo_datasets, :slug, unique: true

    create_table :geo_blocks do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.string :external_id, null: false
      t.string :name, null: false
      t.string :source_name
      t.string :district
      t.jsonb :bbox, null: false, default: []
      t.jsonb :geometry_geojson, null: false, default: {}
      t.jsonb :properties, null: false, default: {}
      t.timestamps
    end
    add_index :geo_blocks, [ :geo_dataset_id, :external_id ], unique: true
    add_index :geo_blocks, [ :geo_dataset_id, :name ]
    add_index :geo_blocks, :properties, using: :gin

    create_table :geo_villages do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.references :geo_block, foreign_key: true
      t.string :external_id, null: false
      t.string :name, null: false
      t.string :block_name, null: false
      t.string :district
      t.string :lgd_code
      t.boolean :asa_coverage, null: false, default: false
      t.jsonb :bbox, null: false, default: []
      t.jsonb :geometry_geojson, null: false, default: {}
      t.jsonb :properties, null: false, default: {}
      t.timestamps
    end
    add_index :geo_villages, [ :geo_dataset_id, :external_id ], unique: true
    add_index :geo_villages, [ :geo_dataset_id, :block_name, :name ]
    add_index :geo_villages, [ :geo_dataset_id, :asa_coverage ]
    add_index :geo_villages, :lgd_code
    add_index :geo_villages, :properties, using: :gin

    create_table :geo_interventions do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.references :geo_block, foreign_key: true
      t.references :geo_village, foreign_key: true
      t.string :external_id, null: false
      t.string :source_id
      t.string :name
      t.string :project, null: false
      t.string :vertical, null: false
      t.string :activity, null: false
      t.string :theme
      t.string :icon
      t.string :block_name
      t.string :village_name
      t.string :lgd_code
      t.decimal :longitude, precision: 12, scale: 8, null: false
      t.decimal :latitude, precision: 12, scale: 8, null: false
      t.boolean :inside_boundary, null: false, default: false
      t.jsonb :source_properties, null: false, default: {}
      t.timestamps
    end
    add_index :geo_interventions, [ :geo_dataset_id, :external_id ], unique: true
    add_index :geo_interventions, [ :geo_dataset_id, :project ]
    add_index :geo_interventions, [ :geo_dataset_id, :vertical ]
    add_index :geo_interventions, [ :geo_dataset_id, :activity ]
    add_index :geo_interventions, [ :geo_dataset_id, :block_name, :village_name ]
    add_index :geo_interventions, [ :geo_dataset_id, :longitude, :latitude ]
    add_index :geo_interventions, :source_properties, using: :gin

    add_check_constraint :geo_interventions,
      "longitude >= -180 AND longitude <= 180",
      name: "geo_interventions_longitude_range"
    add_check_constraint :geo_interventions,
      "latitude >= -90 AND latitude <= 90",
      name: "geo_interventions_latitude_range"
  end
end
