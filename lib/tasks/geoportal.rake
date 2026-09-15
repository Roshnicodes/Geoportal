namespace :geoportal do
  desc "Import private Barwani GeoJSON into PostgreSQL spatial tables"
  task import_barwani: :environment do
    result = BarwaniDataImporter.new.import!

    puts "Imported #{result[:dataset]} dataset"
    puts "Blocks: #{result[:blocks]}"
    puts "Villages: #{result[:villages]}"
    puts "Interventions: #{result[:interventions]}"
    puts "Agribusiness locations: #{result[:agribusiness_locations]}"
    puts "Plantation plots: #{result[:plantation_plots]}"
  end
end
