"use client";

import { api } from "@/lib/api";

export interface CsvImportResult {
  row: number;
  ok: boolean;
  channels?: string;
  scheduledFor?: string;
  created?: number;
  error?: string;
}

export async function uploadCsv(file: File): Promise<CsvImportResult[]> {
  const form = new FormData();
  form.append("file", file);
  return api.upload<CsvImportResult[]>("/posts/csv-import", form);
}
