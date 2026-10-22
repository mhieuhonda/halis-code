/**
 * Stock swarm formations. The swarm setup screen suggests these two lineup
 * presets so a user configuring a team can start from something sensible
 * instead of a blank list — applying a preset fills the agent list with the
 * preset's slots (nothing is persisted until the user saves the team).
 */

export interface FormationSlot {
  /** One of the ids in SWARM_ROLES. */
  roleId: string
  /** Short agent name for the slot. */
  name: string
}

export interface SwarmFormation {
  id: string
  name: string
  nameVi: string
  emoji: string
  description: string
  descriptionVi: string
  slots: FormationSlot[]
}

export const SWARM_FORMATIONS: SwarmFormation[] = [
  {
    id: 'feature-crew',
    name: 'Feature Crew',
    nameVi: 'Đội xây tính năng',
    emoji: '🏗️',
    description: 'Balanced default for building features end-to-end: coordinate, implement, review, test, document.',
    descriptionVi: 'Đội hình mặc định cân bằng để làm tính năng trọn gói: điều phối, triển khai, duyệt code, kiểm thử, viết tài liệu.',
    slots: [
      { roleId: 'chief-of-staff', name: 'Chief' },
      { roleId: 'feature-builder', name: 'Builder' },
      { roleId: 'code-auditor', name: 'Auditor' },
      { roleId: 'test-engineer', name: 'Tester' },
      { roleId: 'docs-writer', name: 'Scribe' },
    ],
  },
  {
    id: 'firefight-crew',
    name: 'Firefight Crew',
    nameVi: 'Đội dập lửa',
    emoji: '🚒',
    description: 'For regressions and hotfixes: hunt the bug, verify the fix, audit the patch, watch the security angle.',
    descriptionVi: 'Dành cho hồi quy và vá lỗi nóng: săn bug, xác minh bản vá, duyệt patch, canh chừng bảo mật.',
    slots: [
      { roleId: 'chief-of-staff', name: 'Chief' },
      { roleId: 'bug-hunter', name: 'Hunter' },
      { roleId: 'test-engineer', name: 'Tester' },
      { roleId: 'code-auditor', name: 'Auditor' },
      { roleId: 'security-sentinel', name: 'Sentinel' },
    ],
  },
]
