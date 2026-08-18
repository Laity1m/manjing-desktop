export type SequentialVideoScene = {
  id: string;
  videoUrl?: string;
  candidateVideoUrl?: string;
  videoReviewDecision?: "pending" | "approved" | "rejected";
  status?: string;
};

export type SequentialVideoPlan =
  | { kind: "review"; index: number; sceneId: string }
  | { kind: "generate"; index: number; sceneId: string }
  | { kind: "complete"; index: -1; sceneId: "" };

/**
 * Returns the single safe next action for a sequential video workflow.
 * A pending candidate always blocks a new paid generation. Approved/imported
 * video is skipped, and the first genuinely missing shot becomes the target.
 */
export function planSequentialVideo(scenes: SequentialVideoScene[]): SequentialVideoPlan {
  const reviewIndex = scenes.findIndex((scene) => Boolean(scene.candidateVideoUrl) && scene.videoReviewDecision === "pending");
  if (reviewIndex >= 0) return { kind: "review", index: reviewIndex, sceneId: scenes[reviewIndex].id };

  const targetIndex = scenes.findIndex((scene) => !scene.videoUrl && !scene.candidateVideoUrl);
  if (targetIndex >= 0) return { kind: "generate", index: targetIndex, sceneId: scenes[targetIndex].id };

  return { kind: "complete", index: -1, sceneId: "" };
}
