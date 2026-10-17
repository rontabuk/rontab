export function getCreatorWorkspaceLabel(status: string | null, isPublic: boolean) {
  if (isPublic) return "Creator studio";
  if (status === "submitted") return "Application pending";
  if (status === "changes_requested" || status === "rejected") return "Update application";
  if (status === "suspended") return "Creator status";
  if (status === "withdrawn") return "Reapply as creator";
  return "Introduce yourself";
}