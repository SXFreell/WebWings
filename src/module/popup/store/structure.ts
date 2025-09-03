// src/module/popup/store/structure.ts
// 用于描述 store/index.ts 的全局变量结构

export interface StoreStructure {
  theme: 'light' | 'dark' | 'auto';
  siderCollapsed: boolean;
  favoriteConfig: FavoriteConfig;
}

export interface FavoriteConfig {
  sort: 'timeDesc' | 'timeAsc' | 'nameDesc' | 'nameAsc' | 'custom';
  view: 'list' | 'icon' | 'tree';
}
