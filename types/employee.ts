export type Employee = {
  employee_id: number;
  school_id: string;
  first_name: string;
  last_name: string;
  /** Joined in from roles — see repositories/employee/read/getEmployees. */
  role_name: string;
  email: string;
  must_change_password: boolean;
  created_at: string;
};

/** password_hash is never accepted from the caller — see repositories/employee/create. */
export type CreateEmployeeInput = {
  school_id: string;
  first_name: string;
  last_name: string;
  /** Must reference an existing row in roles for this school. */
  role_id: number;
};

/** Only ever present on the response to the create call that generated it. */
export type CreatedEmployee = Employee & {
  temporary_password: string;
};
