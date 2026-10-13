export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relation = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert, Relationships extends Relation[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      admin_audit_logs: Table<
        { action: string; actor_id: string; created_at: string; details: Json; entity_id: string | null; entity_type: string; id: number },
        { action: string; actor_id: string; created_at?: string; details?: Json; entity_id?: string | null; entity_type: string; id?: never }
      >;
      categories: Table<
        { created_at: string; description: string | null; id: string; image_url: string | null; is_active: boolean; name: string; parent_id: string | null; slug: string; sort_order: number; updated_at: string },
        { created_at?: string; description?: string | null; id?: string; image_url?: string | null; is_active?: boolean; name: string; parent_id?: string | null; slug: string; sort_order?: number; updated_at?: string },
        [{ foreignKeyName: "categories_parent_id_fkey"; columns: ["parent_id"]; isOneToOne: false; referencedRelation: "categories"; referencedColumns: ["id"] }]
      >;
      product_images: Table<
        { alt_text: string; created_at: string; id: string; media_type: "image" | "video"; product_id: string; sort_order: number; storage_path: string },
        { alt_text?: string; created_at?: string; id?: string; media_type?: "image" | "video"; product_id: string; sort_order?: number; storage_path: string },
        [{ foreignKeyName: "product_images_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] }]
      >;
      products: Table<
        { category_id: string; click_count: number; clicks_since_top_up: number; created_at: string; currency: string; description: string; external_url: string; featured_until: string | null; id: string; name: string; new_until: string | null; price: number | null; published_at: string | null; reviewed_at: string | null; reviewed_by: string | null; seller_profile_id: string; slug: string; status: Database["public"]["Enums"]["product_status"]; updated_at: string },
        { category_id: string; click_count?: number; created_at?: string; currency?: string; description: string; external_url: string; featured_until?: string | null; id?: string; name: string; new_until?: string | null; price?: number | null; published_at?: string | null; reviewed_at?: string | null; reviewed_by?: string | null; seller_profile_id: string; slug: string; status?: Database["public"]["Enums"]["product_status"]; updated_at?: string },
        [
          { foreignKeyName: "products_category_id_fkey"; columns: ["category_id"]; isOneToOne: false; referencedRelation: "categories"; referencedColumns: ["id"] },
          { foreignKeyName: "products_seller_profile_id_fkey"; columns: ["seller_profile_id"]; isOneToOne: false; referencedRelation: "seller_profiles"; referencedColumns: ["id"] }
        ]
      >;
      profiles: Table<
        { avatar_url: string | null; city: string | null; city_id: string | null; country_code: string | null; created_at: string; display_name: string | null; email_verified_at: string | null; id: string; updated_at: string },
        { avatar_url?: string | null; city?: string | null; city_id?: string | null; country_code?: string | null; created_at?: string; display_name?: string | null; id: string; updated_at?: string }
      >;
      seller_profiles: Table<
        { created_at: string; description: string | null; id: string; is_public: boolean; logo_url: string | null; shop_city_id: string | null; shop_name: string; shop_url: string | null; slug: string; status: Database["public"]["Enums"]["seller_status"]; updated_at: string; user_id: string },
        { created_at?: string; description?: string | null; id?: string; is_public?: boolean; logo_url?: string | null; shop_city_id?: string | null; shop_name: string; shop_url?: string | null; slug: string; status?: Database["public"]["Enums"]["seller_status"]; updated_at?: string; user_id: string }
      >;
      seller_contact_details: Table<
        { business_address: string | null; contact_name: string | null; instagram_url: string | null; phone: string | null; phone_contact_confirmed_at: string | null; registered_email: string; registered_email_confirmed_at: string | null; seller_profile_id: string; updated_at: string; website_url: string | null },
        { business_address?: string | null; contact_name?: string | null; instagram_url?: string | null; phone?: string | null; phone_contact_confirmed_at?: string | null; registered_email: string; registered_email_confirmed_at?: string | null; seller_profile_id: string; updated_at?: string; website_url?: string | null }
      >;
      seller_ad_accounts: Table<
        { admin_clicks_remaining: number; clicks_remaining: number; seller_profile_id: string; updated_at: string; welcome_bonus_granted_at: string | null; welcome_clicks_remaining: number },
        { admin_clicks_remaining?: number; clicks_remaining?: number; seller_profile_id: string; updated_at?: string; welcome_bonus_granted_at?: string | null; welcome_clicks_remaining?: number }
      >;
      seller_product_click_allocations: Table<
        { clicks_limit: number; clicks_remaining: number; product_id: string; seller_profile_id: string; updated_at: string },
        { clicks_remaining: number; product_id: string; seller_profile_id: string; updated_at?: string }
      >;
      loyalty_offers: Table<
        { capacity: number; city: string | null; country_code: string | null; created_at: string; created_by: string; description: string; ends_at: string; id: string; image_url: string; minimum_points: number; offer_type: "participation" | "redemption"; points_cost: number; selection_method: "random" | "first_come"; starts_at: string; status: "draft" | "published" | "paused" | "completed" | "cancelled"; summary: string; terms: string; title: string; updated_at: string },
        { capacity: number; city?: string | null; country_code?: string | null; created_at?: string; created_by: string; description?: string; ends_at: string; id?: string; image_url: string; minimum_points: number; offer_type: "participation" | "redemption"; points_cost: number; selection_method?: "random" | "first_come"; starts_at: string; status?: "draft" | "published" | "paused" | "completed" | "cancelled"; summary: string; terms: string; title: string; updated_at?: string }
      >;
      loyalty_offer_city_quotas: Table<
        { capacity: number; city: string; city_id: string | null; country_code: string; created_at: string; offer_id: string },
        never
      >;
      loyalty_offer_claims: Table<
        { city: string | null; city_id: string | null; claim_type: "participation" | "redemption"; created_at: string; country_code: string | null; fulfillment_status: "not_required" | "pending" | "fulfilled"; id: string; offer_id: string; points_spent: number; status: "entered" | "won" | "lost" | "redeemed"; visitor_id: string },
        never
      >;
      supported_countries: Table<
        { country_code: string; country_name: string; created_at: string; is_enabled: boolean },
        never
      >;
      supported_cities: Table<
        { admin_name: string; city_ascii: string; city_id: string; city_name: string; country_code: string; created_at: string; is_enabled: boolean; latitude: number | null; longitude: number | null; population: number },
        never
      >;
      loyalty_accounts: Table<
        { points_balance: number; updated_at: string; visitor_id: string },
        never
      >;
      loyalty_point_transactions: Table<
        { created_at: string; id: number; idempotency_key: string; offer_claim_id: string | null; points_delta: number; source_product_id: string | null; source_product_name: string; transaction_type: "visit_earned" | "participation_spent" | "redemption_spent"; visitor_id: string },
        never
      >;
      marketplace_settings: Table<
        { click_price_pence_per_1000: number; featured_duration_minutes: number; loyalty_random_draws_enabled: boolean; new_products_duration_minutes: number; product_approval_mode: "manual" | "automatic"; seller_approval_mode: "manual" | "automatic"; singleton: boolean; updated_at: string },
        { click_price_pence_per_1000?: number; featured_duration_minutes?: number; loyalty_random_draws_enabled?: boolean; new_products_duration_minutes?: number; product_approval_mode?: "manual" | "automatic"; seller_approval_mode?: "manual" | "automatic"; singleton?: boolean; updated_at?: string }
      >;
      top_video_ads: Table<
        { created_at: string; display_seconds: number; id: string; is_active: boolean; media_type: "video" | "image"; sort_order: number; storage_path: string; target_url: string | null; title: string; updated_at: string },
        never
      >;
      site_announcements: Table<
        { audience: "everyone" | "visitors" | "sellers"; body: string; created_at: string; created_by: string | null; id: string; is_active: boolean; link_url: string | null; title: string },
        never
      >;
      notification_reads: Table<
        { last_seen_at: string; user_id: string },
        never
      >;
      notification_item_reads: Table<
        { notification_id: string; read_at: string; user_id: string },
        never
      >;
      seller_credit_purchases: Table<
        { amount_pence: number; clicks: number; created_at: string; currency: string; id: string; is_test: boolean; paid_at: string | null; paid_event_id: string | null; seller_profile_id: string; status: "pending" | "paid" | "expired"; stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null; unit_price_pence_per_1000: number },
        never
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      admin_review_product: { Args: { p_next_status: Database["public"]["Enums"]["product_status"]; p_product_id: string }; Returns: undefined };
      admin_set_product_featured: { Args: { p_is_featured: boolean; p_product_id: string }; Returns: string | null };
      admin_update_marketplace_settings: { Args: { p_click_price_pence_per_1000: number; p_featured_duration_minutes: number; p_new_products_duration_minutes: number; p_product_approval_mode: "manual" | "automatic"; p_seller_approval_mode: "manual" | "automatic" }; Returns: undefined };
      get_click_price_pence_per_1000: { Args: Record<PropertyKey, never>; Returns: number };
      get_visitor_loyalty_points: { Args: Record<PropertyKey, never>; Returns: number };
      get_visitor_loyalty_summary: { Args: Record<PropertyKey, never>; Returns: { points_balance: number; points_earned: number; points_spent: number }[] };
      get_visitor_loyalty_activity: { Args: Record<PropertyKey, never>; Returns: { created_at: string; id: number; offer_title: string | null; points_delta: number; product_name: string | null; transaction_type: string }[] };
      get_new_products_duration_minutes: { Args: Record<PropertyKey, never>; Returns: number };
      is_eligible_visitor: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_visitor_city_locked: { Args: Record<PropertyKey, never>; Returns: boolean };
      get_visitor_loyalty_offers: { Args: Record<PropertyKey, never>; Returns: { already_joined: boolean; capacity: number; claim_count: number; description: string; ends_at: string; id: string; image_url: string; locations: string[]; minimum_points: number; offer_type: string; points_cost: number; remaining_count: number; selection_method: string; starts_at: string; summary: string; terms: string; title: string }[] };
      get_visitor_offer_history: { Args: Record<PropertyKey, never>; Returns: { claim_type: string; created_at: string; offer_id: string; points_spent: number; status: string; title: string }[] };
      admin_save_loyalty_offer: { Args: { p_city_quotas: Json; p_description: string; p_ends_at: string; p_global_capacity: number; p_image_url: string; p_minimum_points: number; p_offer_id: string | null; p_offer_type: "participation" | "redemption"; p_points_cost: number; p_selection_method: "random" | "first_come"; p_starts_at: string; p_summary: string; p_terms: string; p_title: string }; Returns: string };
      admin_set_loyalty_random_draws_enabled: { Args: { p_enabled: boolean }; Returns: undefined };
      admin_set_loyalty_offer_status: { Args: { p_next_status: "published" | "paused"; p_offer_id: string }; Returns: undefined };
      admin_count_loyalty_offer_eligible: { Args: { p_offer_id: string }; Returns: number };
      admin_get_loyalty_offer_metrics: { Args: Record<PropertyKey, never>; Returns: { claim_count: number; database_now: string; eligible_count: number; offer_id: string; winner_count: number }[] };
      admin_get_loyalty_offer_city_metrics: { Args: Record<PropertyKey, never>; Returns: { admin_name: string | null; capacity: number; claim_count: number; city: string | null; city_id: string | null; country_code: string | null; eligible_count: number; offer_id: string }[] };
      admin_run_loyalty_offer_draw: { Args: { p_offer_id: string }; Returns: number };
      admin_get_loyalty_offer_recipients: { Args: { p_offer_id: string }; Returns: { city: string | null; claim_id: string; country_code: string | null; created_at: string; display_name: string | null; email: string | null; fulfillment_status: string; points_spent: number; status: string; visitor_id: string }[] };
      admin_set_loyalty_claim_fulfilled: { Args: { p_claim_id: string }; Returns: undefined };
      search_supported_cities: { Args: { p_country_code: string; p_query: string }; Returns: { admin_name: string; city_ascii: string; city_id: string; city_name: string; country_code: string }[] };
      join_loyalty_offer: { Args: { p_offer_id: string }; Returns: Json };
      is_product_click_credit_available: { Args: { p_product_id: string }; Returns: boolean };
      record_product_shop_click: { Args: { p_product_id: string; p_visitor_id: string }; Returns: boolean };
      seller_set_product_click_allocations: { Args: { p_allocations: Json }; Returns: undefined };
      seller_save_contact_details: { Args: { p_business_address: string | null; p_contact_name: string | null; p_instagram_url: string | null; p_phone: string | null; p_website_url: string | null }; Returns: undefined };
      seller_confirm_contact_email: { Args: Record<PropertyKey, never>; Returns: undefined };
      visitor_mark_email_verified: { Args: Record<PropertyKey, never>; Returns: boolean };
      mark_notifications_seen: { Args: Record<PropertyKey, never>; Returns: undefined };
      mark_notification_items_read: { Args: { p_notification_ids: string[] }; Returns: string[] };
      seller_create_credit_purchase: { Args: { p_clicks: number; p_expected_rate: number; p_request_id: string; p_seller_id: string }; Returns: Database["public"]["Tables"]["seller_credit_purchases"]["Row"][] };
      billing_attach_credit_checkout: { Args: { p_purchase_id: string; p_session_id: string }; Returns: undefined };
      billing_complete_credit_purchase: { Args: { p_amount_pence: number; p_currency: string; p_event_id: string; p_payment_intent_id: string; p_purchase_id: string; p_session_id: string }; Returns: boolean };
      billing_expire_credit_purchase: { Args: { p_purchase_id: string; p_session_id: string }; Returns: undefined };
      admin_create_announcement: { Args: { p_audience: "everyone" | "visitors" | "sellers"; p_body: string; p_link_url: string | null; p_title: string }; Returns: string };
      admin_set_announcement_active: { Args: { p_announcement_id: string; p_is_active: boolean }; Returns: undefined };
      admin_create_top_video_ad: { Args: { p_display_seconds: number; p_is_active: boolean; p_media_type: "video" | "image"; p_sort_order: number; p_storage_path: string; p_target_url: string | null; p_title: string }; Returns: string };
      admin_update_top_video_ad: { Args: { p_ad_id: string; p_display_seconds: number; p_is_active: boolean; p_sort_order: number; p_target_url: string | null; p_title: string }; Returns: undefined };
      admin_delete_top_video_ad: { Args: { p_ad_id: string }; Returns: string };
      admin_save_category: { Args: { p_category_id: string | null; p_description: string | null; p_image_url: string | null; p_is_active: boolean; p_name: string; p_slug: string; p_sort_order: number }; Returns: string };
      admin_set_seller_status: { Args: { p_is_public: boolean; p_next_status: Database["public"]["Enums"]["seller_status"]; p_seller_id: string }; Returns: undefined };
      admin_grant_seller_ad_credits: { Args: { p_clicks: number; p_note: string; p_seller_id: string }; Returns: number };
      seller_has_new_ad_credit_grants: { Args: Record<PropertyKey, never>; Returns: boolean };
      seller_mark_ad_credit_grants_seen: { Args: Record<PropertyKey, never>; Returns: undefined };
      seller_submit_product: { Args: { p_product_id: string }; Returns: Database["public"]["Enums"]["product_status"] };
      is_active_seller_owner: { Args: { profile_id: string }; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_seller_owner: { Args: { profile_id: string }; Returns: boolean };
    };
    Enums: {
      product_status: "draft" | "pending" | "approved" | "rejected" | "paused" | "archived";
      seller_status: "pending" | "active" | "suspended";
    };
    CompositeTypes: { [_ in never]: never };
  };
};