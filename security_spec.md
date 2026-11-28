# FinTrack Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Multi-Tenant Isolation**: Every document across `/users/{userId}` and all nested subcollections belongs exclusively to `userId == request.auth.uid`. Cross-user reads, lists, creates, updates, or deletes are mathematically impossible.
2. **Email Verification Gate**: All mutating operations (`create`, `update`, `delete`) require `request.auth.token.email_verified == true`.
3. **Immutable Ownership & Timestamps**: `uid` / `userId` and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
4. **Relational Integrity**:
   - Savings contributions under `/users/{userId}/savingsGoals/{goalId}/contributions/{contributionId}` require the parent `/users/{userId}/savingsGoals/{goalId}` to exist and belong to `userId`.
   - Record payments under `/users/{userId}/recordPayments/{paymentId}` require the referenced `parentId` document in either `debtRecords` or `bills` to exist under `/users/{userId}`.
5. **Terminal State Locking**:
   - Once a `SavingsGoal` reaches `status == 'completed'`, it cannot be mutated further.
   - Once a `DebtRecord` reaches `status == 'paid'`, it cannot be mutated further.
   - Once a `BillRecord` with `frequency == 'one_time'` reaches `status == 'paid'`, it cannot be mutated further.
6. **Strict Payload & Size Caps**: Every string field enforces `.size()` limits, every numeric amount validates bounds (`> 0` or `>= 0`), and every document enforces `keys().hasAll(...)` + `keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update.
7. **Admin-Only Global Maintenance Control**: `/appConfig/maintenance` stores only non-PII operational state (`enabled`, `updatedAt`). `get` is permitted for `configId == 'maintenance'` (with `list: if false`) so all visitors see scheduled maintenance immediately, while `create`/`update` require `request.auth.token.email_verified == true && request.auth.token.email == 'maind.go2000@gmail.com'`.
8. **Admin User Directory & Account Deactivation Enforcement**: Only verified admin (`maind.go2000@gmail.com`) may `list` `/users` or `get` other user profiles and update `accountStatus`/`deactivatedAt` (and cannot deactivate the admin account itself). Deactivated users (`accountStatus == 'deactivated'`) are blocked from updating their profile or creating/updating/deleting any financial subcollection document (`isActiveAccount(userId)`).
9. **Admin Pop-Up Messaging Control**: `/users/{userId}/adminMessages/{messageId}` may only be created or deleted by verified admin (`maind.go2000@gmail.com`) with `isRead: false` and `readAt: null` on creation. Verified account owners (both active and deactivated accounts) may read their own messages and update ONLY `['isRead', 'readAt', 'updatedAt']` to acknowledge dismissal (`isRead == true && readAt == request.time`), with zero ability to alter `heading`, `message`, or `senderEmail`.
10. **Ban & Restriction Enforcement (`securityProfiles`)**: Only verified admin (`maind.go2000@gmail.com`) may create, update, or delete `/securityProfiles/{userId}`. Users may only `get` their own profile (no `list`) so client UI and backend token-forwarded REST checks can read restriction state. Active temporary bans (`banType == 'temporary' && banExpiresAt > request.time`) and permanent bans (`banType == 'permanent'`) block financial reads (`get`), all financial writes (`create`, `update`, `delete`), and self-deletion of `/users/{userId}` via `isNotBanned(userId)`.
11. **Admin-Only Sensitive Security Logs & Internal Notes**: `/securityCases/{userId}` (internal notes) and `/securityEvents/{eventId}` (suspicious event logs) are readable (`get`, `list`) ONLY by verified admin (`maind.go2000@gmail.com`). Verified users may only append sanitized `securityEvents` under their own UID (`status == 'open'`, `createdAt == request.time`) and cannot modify or delete events.
12. **Ban Appeals & Messaging Restriction**: Verified owners may create `/securityAppeals/{appealId}` (`status == 'pending'`, `reviewedBy == ''`, `adminDecisionNote == ''`, `reviewedAt == null`) only if they are not messaging-restricted (`isNotMessagingRestricted(userId)`) and may read/list only their own appeals. Only verified admin may review (`update`) appeals.
13. **Immutable Audit Trail**: `/securityAuditLogs/{logId}` can only be created by verified admin (`createdAt == request.time`) and cannot be updated or deleted by anyone (`update: if false; delete: if false;`).
14. **Admin-Gated VIP Subscription Activation (`/vipSubscriptions/{userId}`)**: Owners may only `get` their own subscription (no `list`). Only verified admin (`maind.go2000@gmail.com`) may `create` or activate/upgrade `/vipSubscriptions/{userId}`. Active verified owners may only update `status: 'cancelled'` and `autoRenew: false` while leaving tier, billing cycle, price, and validity dates immutable.
15. **Tamper-Resistant AI Usage Counters (`/aiUsage/{userId}`)**: Owners may only `get` their own usage record (no `list`). Non-admin writes must match the user's verified active subscription tier (`hasAuthorizedAiTier`), and updates within the same `periodKey` are restricted to monotonic increments (`+0` or `+1`) with `lastResetAt` immutable.
16. **UPI Payment Verification Requests (`/vipPaymentRequests/{requestId}`)**: Active, verified, non-banned owners may create pending UPI requests paying to `tntmilan06@slc` with exact INR plan pricing, `status: 'pending'`, and empty review fields. Users may read/list only their own requests and CANNOT update or self-approve them. Only verified admin may review (`update` once from `'pending'` to `'approved'` or `'rejected'`).

## 2. The "Dirty Dozen+" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Cross-Tenant Read/List**: User B (`uid: "userB"`) attempts `getDoc` or `getDocs` on `/users/userA/transactions`.
2. **Identity Spoofing on Create**: User A attempts to create `/users/userA/transactions/tx1` with `userId: "userB"`.
3. **Unverified Email Write**: User A with `email_verified: false` attempts to create a transaction.
4. **Shadow Field Injection (Create)**: User A attempts to create `/users/userA` with an extra ghost key `isAdmin: true`.
5. **Shadow Field Injection (Update)**: User A attempts to update `/users/userA/transactions/tx1` adding `approvedBySystem: true`.
6. **Negative / Zero Amount Fraud**: User A attempts to create a transaction with `amount: -500` or `amount: 0`.
7. **Timestamp Forgery**: User A attempts to create a transaction with a backdated `createdAt` instead of `request.time`.
8. **Immutable Owner Tampering**: User A attempts to update `userId` or `createdAt` on an existing `DebtRecord`.
9. **Path ID Poisoning**: User A attempts to write `/users/userA/transactions/bad$id..with/spaces` or a 500-char ID.
10. **Orphaned Payment Injection**: User A attempts to create `/users/userA/recordPayments/pay1` pointing to a non-existent `parentId: "nonexistent123"`.
11. **Terminal State Bypass**: User A attempts to modify `totalAmount` on a `DebtRecord` whose `status` is already `'paid'`.
12. **Resource Exhaustion (1MB String Bomb)**: User A attempts to create a transaction with `notes` of 50,000 characters or `receiptDataUrl` exceeding 250,000 characters.
13. **Unauthorized Maintenance Toggle**: A non-admin or unverified-email user attempts to write `/appConfig/maintenance` or list `/appConfig`.
14. **Self-Reactivation / Role Tampering**: A deactivated or regular user attempts to update `accountStatus: 'active'` on `/users/{userId}` or write to `/users/{userId}/transactions` while deactivated.
15. **Non-Admin User Enumeration**: Any non-admin user attempts `getDocs(collection(db, 'users'))`.
16. **Forged Admin Pop-Up Message**: A regular user attempts to create a document in `/users/{userId}/adminMessages` impersonating the administrator.
17. **Admin Message Content Tampering**: A user attempts to modify `heading` or `message` on an existing `/users/{userId}/adminMessages/{messageId}` instead of only marking it read.
18. **Self-Unban / VIP Tampering**: A banned or regular user attempts to update `/securityProfiles/{userId}` setting `banType: 'none'` or `vipStatus: 'vip'`.
19. **Internal Admin Notes Leakage**: A regular or banned user attempts to read `/securityCases/{userId}` or list `/securityEvents`.
20. **Appeal Self-Approval**: A banned user attempts to create `/securityAppeals/{id}` with `status: 'approved'` or update an existing appeal's `status`.
21. **Audit Log Tampering**: Even an admin or user attempts to update or delete an entry in `/securityAuditLogs`.
22. **Banned User Financial Read/Write Bypass**: A user with active `temp_banned` or `perm_banned` attempts `getDoc` or `setDoc` on `/users/{userId}/transactions/{txId}` or deletes `/users/{userId}` to wipe evidence.
23. **VIP Price Manipulation**: A user attempts to write `/vipSubscriptions/{userId}` with `tier: 'diamond'` and `priceInr: 1` or forged `paymentReference`.
24. **AI Usage Counter Decrement**: A user attempts to update `/aiUsage/{userId}` reducing `insightsUsed` from `10` back to `0` within the same `periodKey`.
25. **Cross-User Subscription Enumeration**: A non-admin user attempts `getDocs(collection(db, 'vipSubscriptions'))` or `getDocs(collection(db, 'aiUsage'))`.
26. **Self-Activation of VIP Without Admin Approval**: A user attempts to `setDoc` `/vipSubscriptions/{userId}` with `tier: 'diamond', status: 'active'` or upgrade `/aiUsage/{userId}` `tier: 'diamond'`.
27. **Self-Approval of Pending Payment Request**: A user attempts to create `/vipPaymentRequests/{id}` with `status: 'approved'` or update an existing pending request to `'approved'`.
28. **Wrong UPI ID / Amount Injection**: A user submits a payment request with a spoofed `upiId` (not `'tntmilan06@slc'`) or altered `amountInr`.


