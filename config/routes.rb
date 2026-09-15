Rails.application.routes.draw do
  namespace :api do
    scope ":district_slug", module: :barwani, constraints: { district_slug: /[a-z0-9_-]+/ } do
      get "manifest", to: "layers#manifest", defaults: { format: :json }
      get "blocks", to: "layers#blocks", defaults: { format: :geojson }
      get "villages", to: "layers#villages", defaults: { format: :geojson }
      get "poi_wrd_interventions", to: "layers#interventions", defaults: { format: :geojson }
      get "agribusiness_locations", to: "layers#agribusiness_locations", defaults: { format: :geojson }
      get "agribusiness_locations/:id/farmers", to: "layers#agribusiness_farmers", defaults: { format: :json }
      get "agrohorti_plantations", to: "layers#agrohorti_plantations", defaults: { format: :geojson }
    end
  end

  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  root "home#index"
end
