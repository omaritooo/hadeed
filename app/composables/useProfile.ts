import type { FetchError } from "ofetch";
import type { UserProfile, UserTarget } from "~~/shared/types/profile.types";
import { useQuery } from "@pinia/colada";

export interface ProfileResponse {
  profile: (UserProfile & { targets: UserTarget[] }) | null;
  stats: { bmi: number; tdee: number | null; latestWeightKg: number | null } | null;
}

export const useProfile = () => {
  const { $api } = useNuxtApp();

  return useQuery<ProfileResponse, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.profile(),
    query: () => $api<ProfileResponse>("/api/profile"),
  });
};
