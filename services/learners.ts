import type { CreateLearnerInput, Learner, LearnerFilters, UpdateLearnerInput } from '@/types/learner';
import { qs, request } from './http';

export const learnersApi = {
  list: (filters: LearnerFilters = {}) =>
    request<Learner[]>(`/api/learners?${qs({
      learner_id: filters.learner_id,
      class_name: filters.class_name,
      gender_name: filters.gender_name,
      academic_year: filters.academic_year,
    })}`),
  create: (learners: CreateLearnerInput[]) => request<(CreateLearnerInput & { learner_id: string })[]>('/api/learners', { method: 'POST', body: JSON.stringify(learners) }),
  update: (learners: UpdateLearnerInput[]) => request<unknown>('/api/learners', { method: 'PATCH', body: JSON.stringify(learners) }),
  remove: (learnerId: string) => request<unknown>(`/api/learners?learner_id=${encodeURIComponent(learnerId)}`, { method: 'DELETE' }),
};
