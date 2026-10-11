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
        { alt_text: string; created_at: string; id: string; product_id: string; sort_order: number; storage_path: string },
        { alt_text?: string; created_at?: string; id?: string; product_id: string; sort_order?: number; storage_path: string },
        [{ foreignKeyName: "product_images_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] }]
      >;
      products: Table<
        { category_id: string; created_at: string; currency: string; description: string; external_url: string; id: string; name: string; price: number | null; reviewed_at: string | null; reviewed_by: string | null; seller_profile_id: string; slug: string; status: Database["public"]["Enums"]["product_status"]; updated_at: string },
        { category_id: string; created_at?: string; currency?: string; description: string; external_url: string; id?: string; name: string; price?: number | null; reviewed_at?: string | null; reviewed_by?: string | null; seller_profile_id: string; slug: string; status?: Database["public"]["Enums"]["product_status"]; updated_at?: string },
        [
          { foreignKeyName: "products_category_id_fkey"; columns: ["category_id"]; isOneToOne: false; referencedRelation: "categories"; referencedColumns: ["id"] },
          { foreignKeyName: "products_seller_profile_id_fkey"; columns: ["seller_profile_id"]; isOneToOne: false; referencedRelation: "seller_profiles"; referencedColumns: ["id"] }
        ]
      >;
      profiles: Table<
        { avatar_url: string | null; created_at: string; display_name: string | null; id: string; updated_at: string },
        { avatar_url?: string | null; created_at?: string; display_name?: string | null; id: string; updated_at?: string }
      >;
      seller_profiles: Table<
        { created_at: string; description: string | null; id: string; is_public: boolean; logo_url: string | null; shop_name: string; slug: string; status: Database["public"]["Enums"]["seller_status"]; updated_at: string; user_id: string },
        { created_at?: string; description?: string | null; id?: string; is_public?: boolean; logo_url?: string | null; shop_name: string; slug: string; status?: Database["public"]["Enums"]["seller_status"]; updated_at?: string; user_id: string }
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      admin_review_product: { Args: { p_next_status: Database["public"]["Enums"]["product_status"]; p_product_id: string }; Returns: undefined };
      admin_save_category: { Args: { p_category_id: string | null; p_description: string | null; p_image_url: string | null; p_is_active: boolean; p_name: string; p_slug: string; p_sort_order: number }; Returns: string };
      admin_set_seller_status: { Args: { p_is_public: boolean; p_next_status: Database["public"]["Enums"]["seller_status"]; p_seller_id: string }; Returns: undefined };
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