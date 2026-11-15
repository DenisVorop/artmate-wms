import {
  ArrowDownToLine,
  ArrowUpRight,
  Boxes,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  Grid2X2,
  House,
  Layers3,
  MoveRight,
  NotebookTabs,
  PackageCheck,
  Plug,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

type NavigationGroup = {
  label?: string;
  links: { href: string; label: string; icon: LucideIcon }[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    links: [
      { href: "/", label: "Обзор", icon: House },
      { href: "/tasks", label: "Все задания", icon: ClipboardList },
    ],
  },
  {
    label: "Склад",
    links: [
      { href: "/warehouse", label: "Карта склада", icon: Grid2X2 },
      { href: "/inventory", label: "Остатки", icon: Layers3 },
      { href: "/stocktakes", label: "Инвентаризация", icon: ClipboardCheck },
      { href: "/stock-ledger", label: "Журнал учёта", icon: NotebookTabs },
    ],
  },
  {
    label: "Операции",
    links: [
      { href: "/receiving", label: "Приёмка", icon: ArrowDownToLine },
      { href: "/assembly", label: "Сборка", icon: Boxes },
      { href: "/putaway", label: "Размещение коробов", icon: PackageCheck },
      { href: "/movements", label: "Перемещения", icon: MoveRight },
      { href: "/shipments", label: "Отгрузки", icon: ArrowUpRight },
    ],
  },
  {
    label: "Планирование",
    links: [
      {
        href: "/planning",
        label: "Поставки и сборка",
        icon: ChartNoAxesCombined,
      },
      { href: "/integrations", label: "Маркетплейсы", icon: Plug },
    ],
  },
  {
    label: "Сотрудники",
    links: [
      { href: "/team", label: "Команда", icon: UsersRound },
      {
        href: "/performance",
        label: "Смены и выработка",
        icon: ChartNoAxesCombined,
      },
    ],
  },
];

export const navigationLinks = navigationGroups.flatMap(({ links }) => links);
