// Shared parser types (data-model §5).

export type Severity = "error" | "warning";

export type IssueCode =
  | "E-01" | "E-02" | "E-03" | "E-04" | "E-05" | "E-06" | "E-07" | "E-08"
  | "W-01" | "W-02" | "W-03" | "W-04" | "W-05" | "W-06" | "W-07" | "W-08" | "W-09";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  line: number | null; // 1-based line number in the input, null for file-level issues
  message: string;
  source?: string;
}

export interface ParsedTerm {
  id: string;
  term: string;
  meaning: string;
  usage: string;
  clozeOk: boolean;
  line: number;
  definition?: string;
  ipa?: string;
}

export interface ScenarioTurn {
  speaker: string;
  isYou: boolean;
  text: string;
}

export interface ParsedScenario {
  id: string;
  context: string;
  turns: ScenarioTurn[];
  line: number;
}

export interface ParsedNote {
  source: string;
  createdDate: string;
  hasSection: boolean;
  terms: ParsedTerm[];
  scenario: ParsedScenario | null;
  issues: Issue[];
  /** From a "Category:" front-matter line, if present. */
  category?: string;
}

export function severityOf(code: IssueCode): Severity {
  return code.startsWith("E") ? "error" : "warning";
}

export function issue(code: IssueCode, line: number | null, message: string): Issue {
  return { code, severity: severityOf(code), line, message };
}
