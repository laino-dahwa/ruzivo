export type Learner = {
  learner_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  gender_name: string;
  curent_year: string;
  class_name: string;
  enrolment_id: number;
  // Raw ids and the unformatted date accompany the display names so the edit
  // form can preselect the learner's current values without a second fetch.
  gender_id: number;
  class_category_id: number;
  academic_year_id: number;
  date_of_birth: string;
};

export type CreateLearnerInput = {
  school_id: string;
  first_name: string;
  last_name: string;
  gender_id: number;
  date_of_birth: string;
  class_category_id: number;
  academic_year_id: number;
};

export type UpdateLearnerInput = {
  learner_id: string;
  enrolment_id: number;
  first_name?: string;
  last_name?: string;
  gender_id?: number;
  date_of_birth?: string;
  class_category_id?: number;
  academic_year_id?: number;
};

export type LearnerFilters = {
  learner_id?: string | null;
  class_name?: string | null;
  gender_name?: string | null;
  academic_year?: string | null;
};
