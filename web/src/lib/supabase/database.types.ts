// Hand-written minimal types for the tables in supabase/migrations.
// Replace with `supabase gen types typescript` output once the project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type CharacterRow = {
  id: string;
  user_id: string;
  name: string;
  base: 'male' | 'female';
  config: Json;
  schema_version: number;
  status: 'draft' | 'finalized';
  thumbnail_path: string | null;
  created_at: string;
  updated_at: string;
};

export type CharacterInsert = {
  id?: string;
  /** Defaults to auth.uid() in the database. */
  user_id?: string;
  name: string;
  base: 'male' | 'female';
  config: Json;
  schema_version?: number;
  status?: 'draft' | 'finalized';
  thumbnail_path?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CharacterUpdate = Partial<CharacterInsert>;

export type Database = {
  public: {
    Tables: {
      characters: {
        Row: CharacterRow;
        Insert: CharacterInsert;
        Update: CharacterUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
