export interface Brief {
  id: string;
  summary: string;
  highlights: BriefHighlight[];
  open_loops: OpenLoop[];
  generated_at: string;
}

export interface BriefHighlight {
  type: string;
  title: string;
  description: string;
  uio_id: string | null;
}

export interface OpenLoop {
  id: string;
  title: string;
  type: string;
  due_date: string | null;
  priority: "high" | "medium" | "low";
}
