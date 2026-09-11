import { NextResponse } from "next/server";
import { getRoles } from "../../../../../repositories/school/read/getRoles";
import { createRole } from "@/repositories/school/create/createRole";
import { updateRole } from "@/repositories/school/update/updateRole";

import { deleteRole } from "../../../../../repositories/school/delete/deleteRole";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>
}

export async function GET(request: Request, { params }: Params) {

    try {
        const { school_id } = await params;
        const response = await getRoles(school_id)

        return NextResponse.json(response)
    } catch (error) {
        console.error("Get roles error:", error)
        return NextResponse.json(
            {
                error: "Failed to retrieve roles",
            },
            {
                status: 500,
            }
        )

    }
}




export async function POST(request: Request) {
    try {
        const body = await request.json()

        if (!Array.isArray(body)) {
            return NextResponse.json(
                {
                    error: "Request body must be an array of roles"
                },
                {
                    status: 400
                }
            )
        }

        const roles = await createRole(body)

        return NextResponse.json(
            roles,
            {
                status: 201
            }
        )
    } catch (error) {
        console.error("Role Creation Failed :", error)

        return NextResponse.json(
            {
                error: "Role Creation Failure"
            },
            {
                status: 500
            }

        )
    }
}



export async function PATCH(request: Request) {
    try {
        const body = await request.json()

        if (!Array.isArray(body)) {
            return NextResponse.json(
                {
                    error: "Request body must be an array of roles"
                },
                {
                    status: 400
                }
            )
        }


        const roles = await updateRole(body)

        return NextResponse.json(
            roles,
            {
                status: 201
            }
        )
    } catch (error) {
        console.error("Role Update Failed :", error)

        return NextResponse.json(
            {
                error: "Role Update Failure"
            },
            {
                status: 500
            }

        )
    }
}

export async function DELETE(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url)
        const raw = searchParams.get("role_id")

        if (!raw) {
            return NextResponse.json({ error: "role_id is required" }, { status: 400 })
        }

        const deleted = await deleteRole(school_id, parseInt(raw, 10))

        return NextResponse.json(deleted, { status: 200 })
    } catch (error) {
        // Still referenced by real records — a rejected request, not a fault.
        if (error instanceof ReferenceInUseError) {
            return NextResponse.json({ error: error.message }, { status: 409 })
        }

        console.error("Delete failed :", error)
        return NextResponse.json({ error: "Delete failed" }, { status: 500 })
    }
}
