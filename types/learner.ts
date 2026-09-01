export type Learner = {
  learner_id: string;
  first_name: string;
  last_name: string;
  gender_name: string;
  curent_year: string;
  class_name: string;
  enrolment_id: number;
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
