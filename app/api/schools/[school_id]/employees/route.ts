import { NextResponse } from "next/server";
import { getEmployees } from "@/repositories/employee/read/getEmployees";
import { createEmployees } from "@/repositories/employee/create/createEmployee";
import { deleteEmployee } from "@/repositories/employee/delete/deleteEmployee";
import { normalizeToArray, validationErrorBody } from "../../../../../lib/validation/bulk";
import { validateEmployees } from "../../../../../lib/validation/entities";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ school_id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { school_id } = await params;
    const response = await getEmployees(school_id);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Get employees error:", error);
    return NextResponse.json({ error: "Failed to retrieve employees" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const records = normalizeToArray(body);

    if (!records) {
      return NextResponse.json(
        { error: "Request body must be an employee object or an array of employees" },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json([], { status: 201 });
    }

    const errors = validateEmployees(records);
    if (errors.length > 0) {
      return NextResponse.json(validationErrorBody(errors, "Employee"), { status: 400 });
    }

    const created = await createEmployees(records as unknown as Parameters<typeof createEmployees>[0]);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Employee Creation Failed :", error);
    return NextResponse.json({ error: "Employee Creation Failure" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { school_id } = await params;
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("employee_id");

    if (!raw) {
      return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
    }

    const deleted = await deleteEmployee(school_id, parseInt(raw, 10));
    return NextResponse.json(deleted, { status: 200 });
  } catch (error) {
    console.error("Employee Deletion Failed :", error);
    return NextResponse.json({ error: "Employee Deletion Failure" }, { status: 500 });
  }
}
