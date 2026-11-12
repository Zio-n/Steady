
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "calendar_meal_series": {
                  Row: {
                    "archived_at": string | null,"ends_on": string | null,"entries": NonNullable<Json>,"frequency": string,"id": string,"repeat_interval": number,"revision": number,"starts_on": string,"user_id": string,"weekdays": (number)[]
                  }
                  Insert: {
                    "archived_at"?: string | null,"ends_on"?: string | null,"entries": NonNullable<Json>,"frequency": string,"id": string,"repeat_interval": number,"revision"?: number,"starts_on": string,"user_id": string,"weekdays": (number)[]
                  }
                  Update: {
                    "archived_at"?: string | null,"ends_on"?: string | null,"entries"?: NonNullable<Json>,"frequency"?: string,"id"?: string,"repeat_interval"?: number,"revision"?: number,"starts_on"?: string,"user_id"?: string,"weekdays"?: (number)[]
                  }
                  Relationships: [

                  ]
                },"calendar_meal_series_exceptions": {
                  Row: {
                    "local_date": string,"series_id": string,"user_id": string
                  }
                  Insert: {
                    "local_date": string,"series_id": string,"user_id": string
                  }
                  Update: {
                    "local_date"?: string,"series_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_meal_series_exceptions_user_id_series_id_fkey"
      columns: ["user_id","series_id"]
isOneToOne: false
      referencedRelation: "calendar_meal_series"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"calendar_target_transfers": {
                  Row: {
                    "amount_kcal": number,"created_at": string,"destination_date": string,"id": string,"kind": string,"origin_date": string,"request_id": string,"reversal_of": string | null,"user_id": string
                  }
                  Insert: {
                    "amount_kcal": number,"created_at"?: string,"destination_date": string,"id"?: string,"kind": string,"origin_date": string,"request_id": string,"reversal_of"?: string | null,"user_id": string
                  }
                  Update: {
                    "amount_kcal"?: number,"created_at"?: string,"destination_date"?: string,"id"?: string,"kind"?: string,"origin_date"?: string,"request_id"?: string,"reversal_of"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_target_transfers_user_id_destination_date_fkey"
      columns: ["user_id","destination_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    },{
      foreignKeyName: "calendar_target_transfers_user_id_origin_date_fkey"
      columns: ["user_id","origin_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    }
                  ]
                },"catalog_food_aliases": {
                  Row: {
                    "alias": string,"food_id": string,"locale": string,"origin": string,"source_field": string | null
                  }
                  Insert: {
                    "alias": string,"food_id": string,"locale"?: string,"origin"?: string,"source_field"?: string | null
                  }
                  Update: {
                    "alias"?: string,"food_id"?: string,"locale"?: string,"origin"?: string,"source_field"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "catalog_food_aliases_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "catalog_foods"
      referencedColumns: ["id"]
    }
                  ]
                },"catalog_food_nutrients": {
                  Row: {
                    "basis_amount": number,"basis_unit": string,"food_id": string,"normalization_status": string,"nutrient_code": string,"source_nutrient_name": string | null,"source_original_unit": string | null,"source_original_value": number | null,"source_unit": string,"value": number | null,"value_unit": string | null
                  }
                  Insert: {
                    "basis_amount": number,"basis_unit": string,"food_id": string,"normalization_status"?: string,"nutrient_code": string,"source_nutrient_name"?: string | null,"source_original_unit"?: string | null,"source_original_value"?: number | null,"source_unit": string,"value"?: number | null,"value_unit"?: string | null
                  }
                  Update: {
                    "basis_amount"?: number,"basis_unit"?: string,"food_id"?: string,"normalization_status"?: string,"nutrient_code"?: string,"source_nutrient_name"?: string | null,"source_original_unit"?: string | null,"source_original_value"?: number | null,"source_unit"?: string,"value"?: number | null,"value_unit"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "catalog_food_nutrients_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "catalog_foods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "catalog_food_nutrients_nutrient_code_fkey"
      columns: ["nutrient_code"]
isOneToOne: false
      referencedRelation: "catalog_nutrient_definitions"
      referencedColumns: ["nutrient_code"]
    }
                  ]
                },"catalog_food_portions": {
                  Row: {
                    "amount": number,"food_id": string,"grams": number | null,"id": string,"is_default": boolean,"label": string,"millilitres": number | null,"source_record_id": string | null,"unit": string
                  }
                  Insert: {
                    "amount": number,"food_id": string,"grams"?: number | null,"id"?: string,"is_default"?: boolean,"label": string,"millilitres"?: number | null,"source_record_id"?: string | null,"unit": string
                  }
                  Update: {
                    "amount"?: number,"food_id"?: string,"grams"?: number | null,"id"?: string,"is_default"?: boolean,"label"?: string,"millilitres"?: number | null,"source_record_id"?: string | null,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "catalog_food_portions_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "catalog_foods"
      referencedColumns: ["id"]
    }
                  ]
                },"catalog_foods": {
                  Row: {
                    "allergen_traces": string | null,"allergens": string | null,"barcode": string | null,"basis_amount": number,"basis_unit": string,"brand": string | null,"category": string | null,"country_code": string | null,"created_at": string,"data_kind": string,"food_form": string | null,"id": string,"imported_at": string,"ingredients": string | null,"is_active": boolean,"locale": string | null,"name": string,"package_quantity": number | null,"package_unit": string | null,"preparation": string | null,"quality_status": string,"source_id": string,"source_metadata": NonNullable<Json>,"source_record_id": string,"source_updated_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "allergen_traces"?: string | null,"allergens"?: string | null,"barcode"?: string | null,"basis_amount": number,"basis_unit": string,"brand"?: string | null,"category"?: string | null,"country_code"?: string | null,"created_at"?: string,"data_kind": string,"food_form"?: string | null,"id"?: string,"imported_at"?: string,"ingredients"?: string | null,"is_active"?: boolean,"locale"?: string | null,"name": string,"package_quantity"?: number | null,"package_unit"?: string | null,"preparation"?: string | null,"quality_status"?: string,"source_id": string,"source_metadata"?: NonNullable<Json>,"source_record_id": string,"source_updated_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "allergen_traces"?: string | null,"allergens"?: string | null,"barcode"?: string | null,"basis_amount"?: number,"basis_unit"?: string,"brand"?: string | null,"category"?: string | null,"country_code"?: string | null,"created_at"?: string,"data_kind"?: string,"food_form"?: string | null,"id"?: string,"imported_at"?: string,"ingredients"?: string | null,"is_active"?: boolean,"locale"?: string | null,"name"?: string,"package_quantity"?: number | null,"package_unit"?: string | null,"preparation"?: string | null,"quality_status"?: string,"source_id"?: string,"source_metadata"?: NonNullable<Json>,"source_record_id"?: string,"source_updated_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "catalog_foods_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "catalog_sources"
      referencedColumns: ["id"]
    }
                  ]
                },"catalog_nutrient_definitions": {
                  Row: {
                    "name": string,"nutrient_code": string,"sort_order": number,"standard_unit": string
                  }
                  Insert: {
                    "name": string,"nutrient_code": string,"sort_order"?: number,"standard_unit": string
                  }
                  Update: {
                    "name"?: string,"nutrient_code"?: string,"sort_order"?: number,"standard_unit"?: string
                  }
                  Relationships: [

                  ]
                },"catalog_sources": {
                  Row: {
                    "attribution": string | null,"created_at": string,"enabled": boolean,"id": string,"licence": string,"name": string,"source_url": string
                  }
                  Insert: {
                    "attribution"?: string | null,"created_at"?: string,"enabled"?: boolean,"id": string,"licence": string,"name": string,"source_url": string
                  }
                  Update: {
                    "attribution"?: string | null,"created_at"?: string,"enabled"?: boolean,"id"?: string,"licence"?: string,"name"?: string,"source_url"?: string
                  }
                  Relationships: [

                  ]
                },"day_item_history": {
                  Row: {
                    "action": string,"changed_at": string,"eaten_snapshot": NonNullable<Json>,"event_id": string,"item_id": string,"item_revision": number,"selected_amount": number | null,"selected_unit": string | null,"state": Database["public"]['Enums']["day_item_state"],"user_id": string
                  }
                  Insert: {
                    "action": string,"changed_at"?: string,"eaten_snapshot": NonNullable<Json>,"event_id"?: string,"item_id": string,"item_revision": number,"selected_amount"?: number | null,"selected_unit"?: string | null,"state": Database["public"]['Enums']["day_item_state"],"user_id": string
                  }
                  Update: {
                    "action"?: string,"changed_at"?: string,"eaten_snapshot"?: NonNullable<Json>,"event_id"?: string,"item_id"?: string,"item_revision"?: number,"selected_amount"?: number | null,"selected_unit"?: string | null,"state"?: Database["public"]['Enums']["day_item_state"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "day_item_history_user_id_item_id_fkey"
      columns: ["user_id","item_id"]
isOneToOne: false
      referencedRelation: "day_items"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"day_items": {
                  Row: {
                    "created_at": string,"eaten_at": string | null,"eaten_snapshot": Json | null,"id": string,"local_date": string,"manual_override": boolean,"meal_group_id": string | null,"planned_payload": NonNullable<Json>,"revision": number,"section": Database["public"]['Enums']["meal_section"],"selected_amount": number | null,"selected_unit": string | null,"source": Database["public"]['Enums']["day_item_source"],"state": Database["public"]['Enums']["day_item_state"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"eaten_at"?: string | null,"eaten_snapshot"?: Json | null,"id"?: string,"local_date": string,"manual_override"?: boolean,"meal_group_id"?: string | null,"planned_payload"?: NonNullable<Json>,"revision"?: number,"section": Database["public"]['Enums']["meal_section"],"selected_amount"?: number | null,"selected_unit"?: string | null,"source": Database["public"]['Enums']["day_item_source"],"state"?: Database["public"]['Enums']["day_item_state"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"eaten_at"?: string | null,"eaten_snapshot"?: Json | null,"id"?: string,"local_date"?: string,"manual_override"?: boolean,"meal_group_id"?: string | null,"planned_payload"?: NonNullable<Json>,"revision"?: number,"section"?: Database["public"]['Enums']["meal_section"],"selected_amount"?: number | null,"selected_unit"?: string | null,"source"?: Database["public"]['Enums']["day_item_source"],"state"?: Database["public"]['Enums']["day_item_state"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "day_items_user_id_local_date_fkey"
      columns: ["user_id","local_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    }
                  ]
                },"days": {
                  Row: {
                    "base_planned_target_kcal": number | null,"completed_actual_kcal": number | null,"completed_at": string | null,"completed_log_revision": number | null,"completed_target_kcal": number | null,"created_at": string,"local_date": string,"log_revision": number,"nutrient_target_snapshot": NonNullable<Json>,"revision": number,"status": Database["public"]['Enums']["day_status"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "base_planned_target_kcal"?: number | null,"completed_actual_kcal"?: number | null,"completed_at"?: string | null,"completed_log_revision"?: number | null,"completed_target_kcal"?: number | null,"created_at"?: string,"local_date": string,"log_revision"?: number,"nutrient_target_snapshot"?: NonNullable<Json>,"revision"?: number,"status"?: Database["public"]['Enums']["day_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "base_planned_target_kcal"?: number | null,"completed_actual_kcal"?: number | null,"completed_at"?: string | null,"completed_log_revision"?: number | null,"completed_target_kcal"?: number | null,"created_at"?: string,"local_date"?: string,"log_revision"?: number,"nutrient_target_snapshot"?: NonNullable<Json>,"revision"?: number,"status"?: Database["public"]['Enums']["day_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"food_catalogue_origins": {
                  Row: {
                    "catalog_food_id": string,"created_at": string,"food_id": string,"is_personally_adjusted": boolean,"user_id": string
                  }
                  Insert: {
                    "catalog_food_id": string,"created_at"?: string,"food_id": string,"is_personally_adjusted"?: boolean,"user_id": string
                  }
                  Update: {
                    "catalog_food_id"?: string,"created_at"?: string,"food_id"?: string,"is_personally_adjusted"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_catalogue_origins_catalog_food_id_fkey"
      columns: ["catalog_food_id"]
isOneToOne: false
      referencedRelation: "catalog_foods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "food_catalogue_origins_user_id_food_id_fkey"
      columns: ["user_id","food_id"]
isOneToOne: true
      referencedRelation: "foods"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"food_nutrients": {
                  Row: {
                    "field_id": string,"food_id": string,"user_id": string,"value": number | null
                  }
                  Insert: {
                    "field_id": string,"food_id": string,"user_id": string,"value"?: number | null
                  }
                  Update: {
                    "field_id"?: string,"food_id"?: string,"user_id"?: string,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_nutrients_user_id_field_id_fkey"
      columns: ["user_id","field_id"]
isOneToOne: false
      referencedRelation: "nutrient_fields"
      referencedColumns: ["user_id","field_id"]
    },{
      foreignKeyName: "food_nutrients_user_id_food_id_fkey"
      columns: ["user_id","food_id"]
isOneToOne: false
      referencedRelation: "foods"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"foods": {
                  Row: {
                    "archived_at": string | null,"basis_amount": number,"basis_unit": string,"brand": string | null,"calories_kcal": number | null,"created_at": string,"default_portion_amount": number,"default_portion_unit": string,"grams_per_serving": number | null,"id": string,"logging_details": Json | null,"logging_variant_key": string | null,"name": string,"revision": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"basis_amount": number,"basis_unit": string,"brand"?: string | null,"calories_kcal"?: number | null,"created_at"?: string,"default_portion_amount"?: number,"default_portion_unit"?: string,"grams_per_serving"?: number | null,"id"?: string,"logging_details"?: Json | null,"logging_variant_key"?: string | null,"name": string,"revision"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"basis_amount"?: number,"basis_unit"?: string,"brand"?: string | null,"calories_kcal"?: number | null,"created_at"?: string,"default_portion_amount"?: number,"default_portion_unit"?: string,"grams_per_serving"?: number | null,"id"?: string,"logging_details"?: Json | null,"logging_variant_key"?: string | null,"name"?: string,"revision"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"meal_components": {
                  Row: {
                    "amount": number,"component_id": string,"food_id": string,"meal_id": string,"position": number,"unit": string,"user_id": string
                  }
                  Insert: {
                    "amount": number,"component_id"?: string,"food_id": string,"meal_id": string,"position": number,"unit": string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"component_id"?: string,"food_id"?: string,"meal_id"?: string,"position"?: number,"unit"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meal_components_user_id_food_id_fkey"
      columns: ["user_id","food_id"]
isOneToOne: false
      referencedRelation: "foods"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "meal_components_user_id_meal_id_fkey"
      columns: ["user_id","meal_id"]
isOneToOne: false
      referencedRelation: "meals"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"meals": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"name": string,"revision": number,"sections": (Database["public"]['Enums']["meal_section"])[],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name": string,"revision"?: number,"sections"?: (Database["public"]['Enums']["meal_section"])[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"revision"?: number,"sections"?: (Database["public"]['Enums']["meal_section"])[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"mutation_receipts": {
                  Row: {
                    "created_at": string,"input_fingerprint": string,"operation": string,"request_id": string,"result": NonNullable<Json>,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"input_fingerprint": string,"operation": string,"request_id": string,"result": NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"input_fingerprint"?: string,"operation"?: string,"request_id"?: string,"result"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"nutrient_fields": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"display_order": number,"field_id": string,"is_displayed": boolean,"name": string,"standard_key": string | null,"unit": string,"user_id": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"display_order"?: number,"field_id": string,"is_displayed"?: boolean,"name": string,"standard_key"?: string | null,"unit": string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"display_order"?: number,"field_id"?: string,"is_displayed"?: boolean,"name"?: string,"standard_key"?: string | null,"unit"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"profile_target_versions": {
                  Row: {
                    "base_daily_target_kcal": number | null,"created_at": string,"effective_from": string,"nutrient_field_snapshot": NonNullable<Json>,"nutrient_targets": NonNullable<Json>,"revision": number,"timezone": string,"user_id": string
                  }
                  Insert: {
                    "base_daily_target_kcal"?: number | null,"created_at"?: string,"effective_from": string,"nutrient_field_snapshot"?: NonNullable<Json>,"nutrient_targets"?: NonNullable<Json>,"revision"?: number,"timezone": string,"user_id": string
                  }
                  Update: {
                    "base_daily_target_kcal"?: number | null,"created_at"?: string,"effective_from"?: string,"nutrient_field_snapshot"?: NonNullable<Json>,"nutrient_targets"?: NonNullable<Json>,"revision"?: number,"timezone"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"profiles": {
                  Row: {
                    "base_daily_target_kcal": number | null,"created_at": string,"onboarding_complete": boolean,"revision": number,"timezone": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "base_daily_target_kcal"?: number | null,"created_at"?: string,"onboarding_complete"?: boolean,"revision"?: number,"timezone"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "base_daily_target_kcal"?: number | null,"created_at"?: string,"onboarding_complete"?: boolean,"revision"?: number,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"user_food_portion_preferences": {
                  Row: {
                    "amount": number,"food_id": string,"food_kind": string,"unit": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "amount": number,"food_id": string,"food_kind": string,"unit": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"food_id"?: string,"food_kind"?: string,"unit"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "archive_food":
{ Args: { "p_expected_revision": number,"p_food_id": string,"p_request_id": string }; Returns: Json
                           },
"assign_calendar_meal_group":
{ Args: { "p_brand": string,"p_group_id": string,"p_item_id": string,"p_local_date": string,"p_measure": Json,"p_section": Database["public"]['Enums']["meal_section"] }; Returns: undefined
                           },
"calendar_log_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision"?: number,"p_local_date": string,"p_manual_payload"?: Json,"p_planned_item_id"?: string,"p_request_id": string,"p_section": Database["public"]['Enums']["meal_section"],"p_source_id": string,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
"calendar_log_day_items":
{ Args: { "p_items": Json }; Returns: Json
                           },
"calendar_plan_day_item":
{ Args: { "p_amount": number,"p_local_date": string,"p_manual_payload"?: Json,"p_request_id": string,"p_section": Database["public"]['Enums']["meal_section"],"p_source_id": string,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
"calendar_plan_day_items":
{ Args: { "p_items": Json }; Returns: Json
                           },
"complete_calendar_setup":
{ Args: { "p_request_id": string,"p_target_kcal"?: number,"p_timezone": string }; Returns: Json
                           },
"delete_food":
{ Args: { "p_expected_revision": number,"p_food_id": string,"p_request_id": string }; Returns: Json
                           },
"edit_calendar_food_snapshot":
{ Args: { "p_brand": string,"p_calories_per_basis": number,"p_component_index": number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_name": string,"p_nutrients_per_basis": Json,"p_request_id": string }; Returns: Json
                           },
"read_calendar_day":
{ Args: { "p_local_date": string }; Returns: Json
                           },
"read_calendar_day_with_series":
{ Args: { "p_local_date": string }; Returns: Json
                           },
"read_calendar_range":
{ Args: { "p_from_date": string,"p_to_date": string }; Returns: Json
                           },
"read_calendar_range_with_series":
{ Args: { "p_from_date": string,"p_to_date": string }; Returns: Json
                           },
"remove_planned_day_item":
{ Args: { "p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
"reorder_nutrient_fields":
{ Args: { "p_ordered_field_ids": Json }; Returns: Json
                           },
"resize_planned_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
"restore_planned_calendar_item":
{ Args: { "p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
"reverse_calendar_target_transfer":
{ Args: { "p_request_id": string,"p_transfer_id": string }; Returns: Json
                           },
"revise_day_item":
{ Args: { "p_action": string,"p_amount"?: number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string,"p_unit"?: string }; Returns: Json
                           },
"save_calendar_composer":
{ Args: { "p_expected_revision"?: number,"p_items": Json,"p_local_date": string,"p_recurrence"?: Json,"p_replace_group"?: Json,"p_replace_item_id"?: string,"p_request_id": string,"p_series_edit"?: Json,"p_state": string }; Returns: Json
                           },
"save_calendar_target_transfer":
{ Args: { "p_amount_kcal": number,"p_destination_date": string,"p_origin_date": string,"p_request_id": string }; Returns: Json
                           },
"save_calendar_targets":
{ Args: { "p_base_daily_target_kcal": number,"p_effective_from": string,"p_nutrient_targets": Json,"p_request_id": string }; Returns: Json
                           },
"save_catalog_food_copy":
{ Args: { "p_basis_amount": number,"p_basis_unit": string,"p_brand": string,"p_calories_kcal": number,"p_catalog_food_id": string,"p_default_portion_amount": number,"p_default_portion_unit": string,"p_is_personally_adjusted": boolean,"p_name": string,"p_nutrients": Json,"p_request_id": string }; Returns: Json
                           },
"save_food":
{ Args: { "p_basis_amount": number,"p_basis_unit": string,"p_brand": string,"p_calories_kcal": number,"p_default_portion_amount": number,"p_default_portion_unit": string,"p_expected_revision": number,"p_food_id": string,"p_grams_per_serving": number,"p_name": string,"p_nutrients": Json,"p_request_id": string }; Returns: Json
                           },
"save_meal":
{ Args: { "p_components": Json,"p_expected_revision"?: number,"p_meal_id"?: string,"p_name": string,"p_request_id": string,"p_sections": Json }; Returns: Json
                           },
"search_catalog_foods":
{ Args: { "p_limit"?: number,"p_locale"?: string,"p_query": string }; Returns: {
              "basis_amount": number,"basis_unit": string,"brand": string,"calories_kcal": number,"data_kind": string,"food_id": string,"locale": string,"match_locale": string,"match_score": number,"matched_alias": string,"matched_by": string,"name": string,"nutrients": Json,"protein_g": number,"quality_status": string,"source_id": string,"source_licence": string,"source_name": string
            }[]
                           },
"transfer_calendar_plan":
{ Args: { "p_action": string,"p_expected_item_revision": number,"p_from_date": string,"p_item_id": string,"p_request_id": string,"p_to_date": string }; Returns: Json
                           }
          }
          Enums: {
            "day_item_source": "food"|"meal"|"routine","day_item_state": "planned"|"eaten"|"removed","day_status": "open"|"completed","meal_section": "breakfast"|"lunch"|"dinner"|"snack"|"unlabelled"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "day_item_source": ["food", "meal", "routine"],"day_item_state": ["planned", "eaten", "removed"],"day_status": ["open", "completed"],"meal_section": ["breakfast", "lunch", "dinner", "snack", "unlabelled"]
          }
        }
} as const
