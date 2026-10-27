
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "carry_allocations": {
                  Row: {
                    "decision_id": string,"destination_date": string,"destination_revision": number,"signed_delta_kcal": number,"user_id": string
                  }
                  Insert: {
                    "decision_id": string,"destination_date": string,"destination_revision": number,"signed_delta_kcal": number,"user_id": string
                  }
                  Update: {
                    "decision_id"?: string,"destination_date"?: string,"destination_revision"?: number,"signed_delta_kcal"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "carry_allocations_user_id_decision_id_fkey"
      columns: ["user_id","decision_id"]
isOneToOne: false
      referencedRelation: "carry_decisions"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "carry_allocations_user_id_destination_date_fkey"
      columns: ["user_id","destination_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    }
                  ]
                },"carry_decisions": {
                  Row: {
                    "action": Database["public"]['Enums']["carry_action"],"actual_kcal": number,"amount_kcal": number,"completed_target_kcal": number,"created_at": string,"difference_kcal": number,"id": string,"needs_review": boolean,"request_id": string,"reversed_at": string | null,"source_date": string,"source_log_revision": number,"state": Database["public"]['Enums']["carry_state"],"user_id": string
                  }
                  Insert: {
                    "action": Database["public"]['Enums']["carry_action"],"actual_kcal": number,"amount_kcal"?: number,"completed_target_kcal": number,"created_at"?: string,"difference_kcal": number,"id"?: string,"needs_review"?: boolean,"request_id": string,"reversed_at"?: string | null,"source_date": string,"source_log_revision": number,"state"?: Database["public"]['Enums']["carry_state"],"user_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["carry_action"],"actual_kcal"?: number,"amount_kcal"?: number,"completed_target_kcal"?: number,"created_at"?: string,"difference_kcal"?: number,"id"?: string,"needs_review"?: boolean,"request_id"?: string,"reversed_at"?: string | null,"source_date"?: string,"source_log_revision"?: number,"state"?: Database["public"]['Enums']["carry_state"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "carry_decisions_user_id_source_date_fkey"
      columns: ["user_id","source_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    }
                  ]
                },"day_items": {
                  Row: {
                    "created_at": string,"eaten_at": string | null,"eaten_snapshot": Json | null,"id": string,"local_date": string,"manual_override": boolean,"planned_payload": NonNullable<Json>,"revision": number,"routine_occurrence_key": string | null,"section": Database["public"]['Enums']["meal_section"],"selected_amount": number | null,"selected_unit": string | null,"source": Database["public"]['Enums']["day_item_source"],"state": Database["public"]['Enums']["day_item_state"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"eaten_at"?: string | null,"eaten_snapshot"?: Json | null,"id"?: string,"local_date": string,"manual_override"?: boolean,"planned_payload"?: NonNullable<Json>,"revision"?: number,"routine_occurrence_key"?: string | null,"section": Database["public"]['Enums']["meal_section"],"selected_amount"?: number | null,"selected_unit"?: string | null,"source": Database["public"]['Enums']["day_item_source"],"state"?: Database["public"]['Enums']["day_item_state"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"eaten_at"?: string | null,"eaten_snapshot"?: Json | null,"id"?: string,"local_date"?: string,"manual_override"?: boolean,"planned_payload"?: NonNullable<Json>,"revision"?: number,"routine_occurrence_key"?: string | null,"section"?: Database["public"]['Enums']["meal_section"],"selected_amount"?: number | null,"selected_unit"?: string | null,"source"?: Database["public"]['Enums']["day_item_source"],"state"?: Database["public"]['Enums']["day_item_state"],"updated_at"?: string,"user_id"?: string
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
                },"routine_shuffle_suggestions": {
                  Row: {
                    "amount": number,"created_at": string,"day_item_id": string,"local_date": string,"meal_id": string,"meal_name": string,"meal_revision": number,"suggestion_revision": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "amount": number,"created_at"?: string,"day_item_id": string,"local_date": string,"meal_id": string,"meal_name": string,"meal_revision": number,"suggestion_revision"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"day_item_id"?: string,"local_date"?: string,"meal_id"?: string,"meal_name"?: string,"meal_revision"?: number,"suggestion_revision"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "routine_shuffle_suggestions_user_id_day_item_id_fkey"
      columns: ["user_id","day_item_id"]
isOneToOne: false
      referencedRelation: "day_items"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "routine_shuffle_suggestions_user_id_local_date_fkey"
      columns: ["user_id","local_date"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["user_id","local_date"]
    }
                  ]
                },"days": {
                  Row: {
                    "base_planned_target_kcal": number,"completed_actual_kcal": number | null,"completed_at": string | null,"completed_log_revision": number | null,"completed_target_kcal": number | null,"created_at": string,"local_date": string,"log_revision": number,"nutrient_target_snapshot": NonNullable<Json>,"revision": number,"status": Database["public"]['Enums']["day_status"],"updated_at": string,"user_id": string,"week_start": string
                  }
                  Insert: {
                    "base_planned_target_kcal": number,"completed_actual_kcal"?: number | null,"completed_at"?: string | null,"completed_log_revision"?: number | null,"completed_target_kcal"?: number | null,"created_at"?: string,"local_date": string,"log_revision"?: number,"nutrient_target_snapshot"?: NonNullable<Json>,"revision"?: number,"status"?: Database["public"]['Enums']["day_status"],"updated_at"?: string,"user_id": string,"week_start": string
                  }
                  Update: {
                    "base_planned_target_kcal"?: number,"completed_actual_kcal"?: number | null,"completed_at"?: string | null,"completed_log_revision"?: number | null,"completed_target_kcal"?: number | null,"created_at"?: string,"local_date"?: string,"log_revision"?: number,"nutrient_target_snapshot"?: NonNullable<Json>,"revision"?: number,"status"?: Database["public"]['Enums']["day_status"],"updated_at"?: string,"user_id"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "days_user_id_week_start_fkey"
      columns: ["user_id","week_start"]
isOneToOne: false
      referencedRelation: "weeks"
      referencedColumns: ["user_id","week_start"]
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
                    "archived_at": string | null,"basis_amount": number,"basis_unit": string,"brand": string | null,"calories_kcal": number | null,"created_at": string,"default_portion_amount": number,"default_portion_unit": string,"grams_per_serving": number | null,"id": string,"name": string,"revision": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"basis_amount": number,"basis_unit": string,"brand"?: string | null,"calories_kcal"?: number | null,"created_at"?: string,"default_portion_amount"?: number,"default_portion_unit"?: string,"grams_per_serving"?: number | null,"id"?: string,"name": string,"revision"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"basis_amount"?: number,"basis_unit"?: string,"brand"?: string | null,"calories_kcal"?: number | null,"created_at"?: string,"default_portion_amount"?: number,"default_portion_unit"?: string,"grams_per_serving"?: number | null,"id"?: string,"name"?: string,"revision"?: number,"updated_at"?: string,"user_id"?: string
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
                    "archived_at": string | null,"created_at": string,"declared_total_weight_g": number | null,"id": string,"name": string,"revision": number,"sections": (Database["public"]['Enums']["meal_section"])[],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"declared_total_weight_g"?: number | null,"id"?: string,"name": string,"revision"?: number,"sections"?: (Database["public"]['Enums']["meal_section"])[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"declared_total_weight_g"?: number | null,"id"?: string,"name"?: string,"revision"?: number,"sections"?: (Database["public"]['Enums']["meal_section"])[],"updated_at"?: string,"user_id"?: string
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
                },"routine_slots": {
                  Row: {
                    "default_multiplier": number,"meal_id": string | null,"mode": Database["public"]['Enums']["routine_slot_mode"],"position": number,"routine_version_id": string,"section": Database["public"]['Enums']["meal_section"],"slot_id": string,"user_id": string,"weekday": number
                  }
                  Insert: {
                    "default_multiplier"?: number,"meal_id"?: string | null,"mode": Database["public"]['Enums']["routine_slot_mode"],"position"?: number,"routine_version_id": string,"section": Database["public"]['Enums']["meal_section"],"slot_id": string,"user_id": string,"weekday": number
                  }
                  Update: {
                    "default_multiplier"?: number,"meal_id"?: string | null,"mode"?: Database["public"]['Enums']["routine_slot_mode"],"position"?: number,"routine_version_id"?: string,"section"?: Database["public"]['Enums']["meal_section"],"slot_id"?: string,"user_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "routine_slots_user_id_meal_id_fkey"
      columns: ["user_id","meal_id"]
isOneToOne: false
      referencedRelation: "meals"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "routine_slots_user_id_routine_version_id_fkey"
      columns: ["user_id","routine_version_id"]
isOneToOne: false
      referencedRelation: "routine_versions"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"routine_versions": {
                  Row: {
                    "created_at": string,"effective_from": string,"id": string,"revision": number,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"effective_from": string,"id"?: string,"revision"?: number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"id"?: string,"revision"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"week_allocations": {
                  Row: {
                    "base_target_kcal": number,"override_target_kcal": number | null,"user_id": string,"week_start": string,"weekday": number
                  }
                  Insert: {
                    "base_target_kcal": number,"override_target_kcal"?: number | null,"user_id": string,"week_start": string,"weekday": number
                  }
                  Update: {
                    "base_target_kcal"?: number,"override_target_kcal"?: number | null,"user_id"?: string,"week_start"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "week_allocations_user_id_week_start_fkey"
      columns: ["user_id","week_start"]
isOneToOne: false
      referencedRelation: "weeks"
      referencedColumns: ["user_id","week_start"]
    }
                  ]
                },"weekly_pattern_days": {
                  Row: {
                    "pattern_version_id": string,"target_kcal": number,"user_id": string,"weekday": number
                  }
                  Insert: {
                    "pattern_version_id": string,"target_kcal": number,"user_id": string,"weekday": number
                  }
                  Update: {
                    "pattern_version_id"?: string,"target_kcal"?: number,"user_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "weekly_pattern_days_user_id_pattern_version_id_fkey"
      columns: ["user_id","pattern_version_id"]
isOneToOne: false
      referencedRelation: "weekly_pattern_versions"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"weekly_pattern_versions": {
                  Row: {
                    "base_daily_target_kcal": number,"created_at": string,"effective_week_start": string,"id": string,"user_id": string
                  }
                  Insert: {
                    "base_daily_target_kcal": number,"created_at"?: string,"effective_week_start": string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "base_daily_target_kcal"?: number,"created_at"?: string,"effective_week_start"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"weeks": {
                  Row: {
                    "allocation_kind": Database["public"]['Enums']["allocation_kind"],"budget_kcal": number,"created_at": string,"revision": number,"source_pattern_version_id": string | null,"updated_at": string,"user_id": string,"week_start": string
                  }
                  Insert: {
                    "allocation_kind"?: Database["public"]['Enums']["allocation_kind"],"budget_kcal": number,"created_at"?: string,"revision"?: number,"source_pattern_version_id"?: string | null,"updated_at"?: string,"user_id": string,"week_start": string
                  }
                  Update: {
                    "allocation_kind"?: Database["public"]['Enums']["allocation_kind"],"budget_kcal"?: number,"created_at"?: string,"revision"?: number,"source_pattern_version_id"?: string | null,"updated_at"?: string,"user_id"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "weeks_user_id_source_pattern_version_id_fkey"
      columns: ["user_id","source_pattern_version_id"]
isOneToOne: false
      referencedRelation: "weekly_pattern_versions"
      referencedColumns: ["user_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "ensure_routine_day":
{ Args: { "p_local_date": string }; Returns: Json
                           },
            "ensure_day_snapshot":
{ Args: { "p_local_date": string }; Returns: Json
                           },
            "complete_day":
{ Args: { "p_expected_day_revision": number,"p_expected_log_revision": number,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
            "save_carry_decision":
{ Args: { "p_action": Database["public"]["Enums"]["carry_action"],"p_allocations": Json,"p_amount_kcal": number,"p_expected_log_revision": number,"p_expected_source_revision": number,"p_expected_week_revision": number,"p_request_id": string,"p_source_date": string,"p_week_start": string }; Returns: Json
                           },
            "reverse_carry_decision":
{ Args: { "p_decision_id": string,"p_expected_revisions": Json,"p_expected_week_revision": number,"p_request_id": string }; Returns: Json
                           },
            "archive_food":
{ Args: { "p_expected_revision": number,"p_food_id": string,"p_request_id": string }; Returns: Json
                           },
            "complete_profile_onboarding":
{ Args: { "p_base_daily_target_kcal": number,"p_displayed_fields": Json,"p_nutrient_targets": Json,"p_request_id": string,"p_timezone": string }; Returns: Json
                           },
"reorder_nutrient_fields":
{ Args: { "p_ordered_field_ids": Json }; Returns: Json
                           },
            "delete_food":
{ Args: { "p_expected_revision": number,"p_food_id": string,"p_request_id": string }; Returns: Json
                           },
            "log_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision"?: number,"p_local_date": string,"p_manual_payload"?: Json,"p_planned_item_id"?: string,"p_request_id": string,"p_section": Database["public"]["Enums"]["meal_section"],"p_source_id": string | null,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
            "plan_day_item":
{ Args: { "p_amount": number,"p_local_date": string,"p_manual_payload"?: Json,"p_request_id": string,"p_section": Database["public"]["Enums"]["meal_section"],"p_source_id": string | null,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
            "remove_planned_day_item":
{ Args: { "p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
            "resize_planned_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
            "replace_planned_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_manual_payload"?: Json,"p_request_id": string,"p_section": Database["public"]["Enums"]["meal_section"],"p_source_id": string | null,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
            "use_shuffle_suggestion":
{ Args: { "p_expected_item_revision": number,"p_expected_meal_revision": number,"p_expected_suggestion_revision": number,"p_item_id": string,"p_local_date": string,"p_meal_id": string,"p_request_id": string }; Returns: Json
                           },
            "save_routine_shuffle_suggestion":
{ Args: { "p_expected_item_revision": number,"p_expected_meal_revision": number,"p_expected_suggestion_revision": number,"p_item_id": string,"p_local_date": string,"p_meal_id": string,"p_request_id": string }; Returns: Json
                           },
            "accept_whole_day_shuffle":
{ Args: { "p_changes": Json,"p_local_date": string,"p_request_id": string }; Returns: Json
                           },
            "ensure_week":
{ Args: { "p_week_start": string }; Returns: Json
                           },
            "save_week_allocation":
{ Args: { "p_allocation_kind": Database["public"]["Enums"]["allocation_kind"],"p_expected_revision": number,"p_request_id": string,"p_targets": Json,"p_week_start": string }; Returns: Json
                           },
            "revise_day_item":
{ Args: { "p_action": string,"p_amount"?: number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_request_id": string,"p_unit"?: string }; Returns: Json
                           },
            "replace_day_item":
{ Args: { "p_amount": number,"p_expected_item_revision": number,"p_item_id": string,"p_local_date": string,"p_manual_payload"?: Json,"p_request_id": string,"p_section": Database["public"]["Enums"]["meal_section"],"p_source_id": string | null,"p_source_kind": string,"p_unit": string }; Returns: Json
                           },
            "correct_completed_day_item":
{ Args: { "p_action": string,"p_amount"?: number,"p_expected_day_revision": number,"p_expected_item_revision": number,"p_expected_log_revision": number,"p_item_id": string,"p_local_date": string,"p_manual_payload"?: Json,"p_request_id": string,"p_section"?: Database["public"]["Enums"]["meal_section"],"p_source_id"?: string | null,"p_source_kind"?: string,"p_unit"?: string }; Returns: Json
                           },
            "save_food":
{ Args: { "p_basis_amount": number,"p_basis_unit": string,"p_brand": string | null,"p_calories_kcal": number | null,"p_default_portion_amount": number,"p_default_portion_unit": string,"p_expected_revision": number | null,"p_food_id": string | null,"p_grams_per_serving": number | null,"p_name": string,"p_nutrients": Json,"p_request_id": string }; Returns: Json
                           },
"save_meal":
{ Args: { "p_components": Json,"p_declared_total_weight_g"?: number,"p_expected_revision"?: number,"p_meal_id"?: string,"p_name": string,"p_request_id": string,"p_sections": Json }; Returns: Json
                           },
            "save_profile_targets":
{ Args: { "p_allocation_strategy"?: string,"p_base_daily_target_kcal": number,"p_expected_revision": number,"p_nutrient_targets": Json,"p_request_id": string }; Returns: Json
                           },
            "save_routine_version":
{ Args: { "p_effective_from": string,"p_expected_revision": number | null,"p_request_id": string,"p_slots": Json }; Returns: Json
                           }
          }
          Enums: {
            "allocation_kind": "recurring"|"one_off","carry_action": "none"|"single_day"|"spread","carry_state": "active"|"reversed"|"superseded","day_item_source": "food"|"meal"|"routine","day_item_state": "planned"|"eaten"|"removed","day_status": "open"|"completed","meal_section": "breakfast"|"lunch"|"dinner"|"snack","routine_slot_mode": "fixed"|"shuffle"
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
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "allocation_kind": ["recurring", "one_off"],"carry_action": ["none", "single_day", "spread"],"carry_state": ["active", "reversed", "superseded"],"day_item_source": ["food", "meal", "routine"],"day_item_state": ["planned", "eaten", "removed"],"day_status": ["open", "completed"],"meal_section": ["breakfast", "lunch", "dinner", "snack"],"routine_slot_mode": ["fixed", "shuffle"]
          }
        }
} as const
