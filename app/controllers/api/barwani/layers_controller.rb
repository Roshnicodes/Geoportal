module Api
  module Barwani
    class LayersController < ApplicationController
      before_action :set_dataset

      rescue_from ActiveRecord::RecordNotFound do
        render json: { error: "Spatial dataset is not imported yet" }, status: :not_found
      end

      def manifest
        render json: @dataset.manifest_payload
      end

      def blocks
        render json: feature_collection(@dataset.geo_blocks.order(:name).map(&:to_geojson_feature))
      end

      def villages
        features = @dataset.geo_villages.order(:block_name, :name).map(&:to_geojson_feature)
        render json: feature_collection(features)
      end

      def interventions
        features = @dataset.geo_interventions.order(:id).map(&:to_geojson_feature)
        render json: feature_collection(features)
      end

      def agribusiness_locations
        features = @dataset.geo_agribusiness_locations
          .includes(:geo_agribusiness_farmers)
          .order(:block_name, :village_name, :name)
          .map(&:to_geojson_feature)
        render json: feature_collection(features)
      end

      def agribusiness_farmers
        location = @dataset.geo_agribusiness_locations
          .includes(:geo_agribusiness_farmers)
          .find_by!(external_id: params[:id])
        farmers = location.geo_agribusiness_farmers.order(:village_name, :farmer_name, :id).map(&:to_detail_payload)
        render json: {
          location: location.to_geojson_feature.fetch("properties"),
          farmers: farmers
        }
      end

      def agrohorti_plantations
        features = @dataset.geo_plantation_plots.order(:fy, :block_name, :village_name, :farmer_name).map(&:to_geojson_feature)
        render json: feature_collection(features)
      end

      private

      def set_dataset
        @dataset = GeoDataset.find_by!(slug: params[:district_slug].presence || "barwani")
      end

      def feature_collection(features)
        {
          "type" => "FeatureCollection",
          "bbox" => @dataset.bbox,
          "features" => features
        }
      end
    end
  end
end
