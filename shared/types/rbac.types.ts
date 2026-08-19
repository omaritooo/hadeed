export interface Role {
  id: number
  key: string
  name: string
  permissions: string[]
}

export interface RequestContext {
  userId: string
  roles: string[]
  permissions: string[]
}
