import { CircleHelp, ClipboardList, LayoutDashboard, Package, ReceiptText, Store, UserRound, Users } from '@lucide/vue'

export const adminSections = [
  { to: '/admin', label: 'Tableau de bord', exact: true, icon: LayoutDashboard },
  { to: '/admin/clients', label: 'Clients', icon: Users },
  { to: '/admin/commandes', label: 'Commandes', icon: ReceiptText },
  { to: '/admin/catalogue', label: 'Catalogue', icon: Package },
  { to: '/admin/aide', label: 'Aide', icon: CircleHelp },
]

export const clientSections = [
  { to: '/', label: 'Boutique', exact: true, icon: Store },
  { to: '/commandes', label: 'Mes commandes', icon: ClipboardList },
  { to: '/compte', label: 'Mon compte', icon: UserRound },
]
