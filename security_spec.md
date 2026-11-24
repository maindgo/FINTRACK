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

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
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
