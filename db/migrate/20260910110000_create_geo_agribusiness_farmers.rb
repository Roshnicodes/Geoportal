class CreateGeoAgribusinessFarmers < ActiveRecord::Migration[8.1]
  def change
    create_table :geo_agribusiness_farmers do |t|
      t.references :geo_dataset, null: false, foreign_key: true
      t.references :geo_agribusiness_location, null: false, foreign_key: true
      t.string :external_id
      t.string :family_id
      t.string :farmer_name
      t.string :father_husband_name
      t.string :fpc_name
      t.string :fy
      t.string :block_name
      t.string :village_name
      t.string :gram_panchayat
      t.string :khasra_no
      t.string :plot_no
      t.string :irrigation_source
      t.string :land_type
      t.string :crop_name
      t.string :crop_type
      t.string :activity_name
      t.jsonb :properties, null: false, default: {}
      t.timestamps
    end

    add_index :geo_agribusiness_farmers, [ :geo_dataset_id, :external_id ]
    add_index :geo_agribusiness_farmers, [ :geo_agribusiness_location_id, :farmer_name ]
    add_index :geo_agribusiness_farmers, [ :geo_dataset_id, :block_name, :village_name ]
    add_index :geo_agribusiness_farmers, [ :geo_dataset_id, :fy ]
    add_index :geo_agribusiness_farmers, :properties, using: :gin
  end
end
