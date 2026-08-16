# react-multiple-video-form-manager

[English](./README.md)

[![CI](https://github.com/curry-battle/react-multiple-video-form-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/curry-battle/react-multiple-video-form-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

React 向けのヘッドレスな複数動画管理ライブラリ。追加・削除・並べ替え・差し替え、サムネイル管理（フレームキャプチャ / ファイルアップロード）をバリデーションとプレビューURL管理付きで提供します。

**React Hook Form** と **TanStack Form** に対応し、**Zod** / **Valibot** スキーマ統合もサポートしています。

## 特徴

- ヘッドレス (render-prop) API — UIは自由に実装可能
- 動画の追加・削除・並べ替え・差し替えを宣言的に管理
- サムネイル管理: フレームキャプチャ、ファイルアップロード、削除
- `deletedVideoIds` フィールドによる削除動画の個別追跡
- `usePreviewUrl` / `useThumbnailPreviewUrl` hook による blob URL ライフサイクルの自動管理
- `processFile` / `processThumbnailFile` コールバックでクライアント側の前処理
- `uploadOnSelect` prop で選択時即アップロード
- Zod & Valibot スキーマファクトリ（制約設定を共有）
- i18n 対応のエラーメッセージ

## パッケージ構成

| パッケージ | 説明 |
|-----------|------|
| [`packages/react-multiple-video-form-manager`](./packages/react-multiple-video-form-manager/) | コアライブラリ (`@curry-battle/react-multiple-video-form-manager`) |
| [`examples/video-form-rhf`](./examples/video-form-rhf/) | React Hook Form のサンプルアプリ |
| [`examples/video-form-tanstack`](./examples/video-form-tanstack/) | TanStack Form のサンプルアプリ |

## クイックスタート

```bash
pnpm install
```

### サンプルアプリの起動

```bash
# React Hook Form
pnpm run dev:example:rhf

# TanStack Form
pnpm run dev:example:tanstack
```

### ライブラリ開発

```bash
# ビルド
pnpm run build

# ユニットテスト (Vitest Browser Mode)
pnpm run test

# E2E テスト (Playwright)
pnpm run test:e2e

# 型チェック
pnpm run typecheck

# Lint & フォーマット (Biome)
pnpm run check
```

## ドキュメント

API ドキュメント・使用例・エクスポートマップは[ライブラリの README](./packages/react-multiple-video-form-manager/README.md) を参照してください。

## アーキテクチャ

**Hexagonal Architecture (Ports & Adapters)** により、動画・サムネイル管理ロジックの 99% をフォーム非依存に保っています。詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

```
App ─┬─ react-hook-form adapter ─┐
     └─ tanstack-form adapter  ──┤
                                  └─▶ core (useMultiVideoCore, videoListOps, ThumbnailUtils)
```

## リリース手順

リリースは [release-please](https://github.com/googleapis/release-please) が自動化しています。手動でのバージョン更新とタグ付けは不要です。

1. conventional commit 形式のタイトルを付けた PR を squash マージする。
2. release-please が、バージョンの bump と `CHANGELOG.md` の更新を含むリリース PR を作成・更新する。
3. リリース PR をマージすると、タグと Draft Release が作られ、GitHub Packages への publish が成功した時点で Release が公開される。

バージョンはコミットの型から決まる。`v0.x` のあいだは `feat:` も breaking change も minor、`fix:` は patch。

## ライセンス

[MIT](./LICENSE)
