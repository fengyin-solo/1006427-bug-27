import { defineStore } from 'pinia'

// 厂内运行班组：归属判定以班组为单位，同一台终端可以换班登录。
export const SHIFT_TEAMS = ['运行一班', '运行二班', '运行三班']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    team: SHIFT_TEAMS[0],
    scope: '生活垃圾焚烧发电厂运行管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      this.team = team
    },
  },
})
