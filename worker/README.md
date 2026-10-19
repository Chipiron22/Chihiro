# AIコーチの設定手順

アプリの「AIコーチに相談」を使うための中継サーバー(Cloudflare Worker)を作ります。
所要時間は30分ほどです。費用は、Cloudflare側は無料枠で足り、Anthropic側は使った分だけです。

## しくみと上限

```
アプリ(スマホ) → 中継サーバー(合言葉と上限を確認) → Anthropic API
```

- APIキーは中継サーバーだけが持ちます。アプリには入れません。
- 合言葉を知っている人だけが使えます。
- 利用額は二重の仕組みで守ります。
  1. **中継サーバーの上限**: 1か月の利用額が `BUDGET_YEN`(初期値300円)に達すると、中継サーバーが止めます。直前の1回分だけ、数円超える場合があります。
  2. **Anthropic側の上限**: 管理画面で月の利用上限を設定します。1の予備です。

## 1. Anthropicの準備

1. https://platform.claude.com でアカウントを作ります。
2. **Billing(請求)** で支払い方法を登録し、少額(5ドル程度)のクレジットを購入します。
3. 同じ画面の **Spend limits** で **Set limit** を押し、月の上限を **3ドル** 前後にします。
4. **API keys** で **Create key** を押し、名前を `badminton` にして作成します。表示された文字列をコピーします。**この画面を閉じると、二度と表示されません。**

> APIキーはパスワードと同じです。チャットやメールには貼らないでください。

## 2. Cloudflareの準備

1. https://dash.cloudflare.com で無料アカウントを作ります。
2. 左のメニューの **Workers & Pages** を開き、**Create** → **Create Worker** を選びます。
3. 名前を `badminton-coach` にして **Deploy** を押します。
4. 完成画面の **Edit code** を押し、最初から入っているコードをすべて消します。
5. このフォルダの `worker.js` の中身をすべてコピーして貼り付け、右上の **Deploy** を押します。

## 3. 利用額を記録する場所(KV)を作る

1. 左のメニューの **Storage & Databases** → **KV** を開き、**Create** を押します。
2. 名前を `usage` にして作成します。
3. `badminton-coach` の **Settings** → **Bindings** → **Add** → **KV namespace** を選びます。
4. **Variable name** に `USAGE`(大文字)と入力し、先ほどの `usage` を選んで保存します。

## 4. 設定値を入れる

`badminton-coach` の **Settings** → **Variables and Secrets** で、次の4つを追加します。

| 名前 | 種類 | 値 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | 1でコピーしたAPIキー |
| `ACCESS_KEY` | Secret | ご自分で決めた合言葉(12文字以上の英数字) |
| `ALLOWED_ORIGIN` | Text | `https://chipiron22.github.io` |
| `BUDGET_YEN` | Text | `300` |

追加したら **Deploy** を押して反映します。

## 5. アプリに入れる

1. Workerの画面に表示されている `https://badminton-coach.〇〇.workers.dev` のURLをコピーします。
2. アプリの **設定** → **AIコーチ設定** に、URLと合言葉を入力して **保存** を押します。
3. **今月の利用額を確認** を押して「約0円 / 上限300円」と出れば成功です。

## うまくいかないとき

| 表示 | 確認すること |
|---|---|
| 通信に失敗しました | URLの打ち間違いがないか。Workerを **Deploy** したか。 |
| 合言葉が違います | アプリの合言葉と `ACCESS_KEY` が同じか。 |
| 許可されていないアクセス元です | `ALLOWED_ORIGIN` が `https://chipiron22.github.io` になっているか(末尾に `/` を付けない)。 |
| 利用額の記録場所が未設定です | KVのバインディング名が `USAGE` か。 |

## 設定を変えたいとき

- **上限の金額**: `BUDGET_YEN` を変えます。
- **為替**: `YEN_PER_USD`(初期値150)を追加すると、円への換算が変わります。
- **モデル**: `worker.js` の `MODEL` と `PRICE_USD_PER_MTOK` を変えます。料金はAnthropicの料金ページで確認してください。
