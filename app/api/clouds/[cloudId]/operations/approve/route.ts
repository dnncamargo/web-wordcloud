import { handleTeacherMutation } from "@/lib/firebase/serverRoute";
export async function POST(request: Request, { params }: { params: Promise<{ cloudId: string }> }) { return handleTeacherMutation(request, (await params).cloudId, "approve"); }
