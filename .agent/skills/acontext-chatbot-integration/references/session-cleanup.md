# Session Cleanup

**IMPORTANT: When deleting a conversation, must delete both Acontext Session and Disk to avoid resource leaks!**

## Delete Session

```ts
export async function deleteSession(sessionId: string, diskId: string) {
  const acontext = getAcontextClient();

  try {
    // 1. Delete Acontext Session (messages deleted)
    if (acontext) {
      await acontext.sessions.delete(sessionId);
      console.log(`[Cleanup] Deleted Acontext session: ${sessionId}`);
    }

    // 2. Delete Acontext Disk (files deleted)
    if (acontext && diskId) {
      await acontext.disks.delete(diskId);
      console.log(`[Cleanup] Deleted Acontext disk: ${diskId}`);
    }

    // 3. Delete database mapping
    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("acontext_session_id", sessionId);

    if (error) {
      console.error(`[Cleanup] Failed to delete mapping: ${error.message}`);
    }

    return { success: true };
  } catch (error) {
    console.error("[Cleanup] Failed to delete session:", error);
    return { success: false, error: String(error) };
  }
}
```

## Common Mistake

```ts
// WRONG: Only delete mapping, Acontext resources leak
await supabase.from("chat_sessions").delete().eq("id", sessionId);
// Session and Disk still exist in Acontext, wasting resources!

// CORRECT: Delete both Acontext and database
await acontext.sessions.delete(sessionId);
await acontext.disks.delete(diskId);
await supabase.from("chat_sessions").delete().eq("acontext_session_id", sessionId);
```

## Batch Cleanup (Optional)

```ts
export async function cleanupExpiredSessions(userId: string, daysOld: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const { data: expiredSessions } = await supabase
    .from("session_mappings")
    .select("acontext_session_id, acontext_disk_id")
    .eq("user_id", userId)
    .lt("updated_at", cutoffDate.toISOString());

  if (!expiredSessions?.length) return { deleted: 0 };

  let deleted = 0;
  for (const session of expiredSessions) {
    try {
      await acontext.sessions.delete(session.acontext_session_id);
      await acontext.disks.delete(session.acontext_disk_id);
      await supabase
        .from("session_mappings")
        .delete()
        .eq("acontext_session_id", session.acontext_session_id);
      deleted++;
    } catch (error) {
      console.error(`[Cleanup] Failed to delete ${session.acontext_session_id}`);
    }
  }

  return { deleted, total: expiredSessions.length };
}
```
