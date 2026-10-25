"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { providerName, useMarketplaces } from "@/entities/marketplaces";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { useIntegrationActions } from "../model/use-integration-actions";
import { connectionPayload, mappingPayload } from "../lib/integration-form";
import { ConnectionCard } from "./connection-card";
import { ProductMapping } from "./product-mapping";
import styles from "./marketplace-integration.module.css";

export function MarketplaceIntegrationFeature() {
  const session = useSession(),
    query = useMarketplaces(session.isManager),
    workspace = useWorkspace();
  const actions = useIntegrationActions();
  const [notice, setNotice] = useState("");
  if (query.isPending) return <LoadingState label="Загружаем подключения…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;
  const data = query.data,
    skus = workspace.data?.skus ?? [];
  const unmapped = data.products.filter((product) => !product.skuId).length;
  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">ВНЕШНИЕ ДАННЫЕ</p>
          <h1 className="page-heading">Маркетплейсы</h1>
          <p>
            Продажи и остатки Wildberries и Ozon для плана сборки. Товар на
            маркетплейсах учитывается отдельно от баланса склада.
          </p>
        </div>
        <Link className="button button--secondary" href="/planning">
          План сборки <ArrowUpRight size={16} />
        </Link>
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {query.isError && (
        <p className={styles.error} role="alert">
          Не удалось обновить подключения. На экране последние загруженные
          данные.
        </p>
      )}
      {actions.error && (
        <p className={styles.error} role="alert">
          {actions.error}
        </p>
      )}
      <div className={styles.cards}>
        {data.connections.map((connection) => (
          <ConnectionCard
            key={connection.provider}
            connection={connection}
            pending={actions.pending}
            onSave={async (values) => {
              const success = await actions.connect(
                connectionPayload(connection.provider, values),
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: ключ сохранён. Нажмите «Загрузить данные», чтобы проверить подключение.`,
                );
              return success;
            }}
            onSync={async () => {
              const success = await actions.sync(connection.provider);
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: запрос загрузки завершён. Результат указан в карточке подключения.`,
                );
              return success;
            }}
            onToggle={async () => {
              const success = await actions.toggle(
                connection.provider,
                !connection.enabled,
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: подключение ${connection.enabled ? "отключено" : "включено"}.`,
                );
              return success;
            }}
          />
        ))}
      </div>
      <section
        className={`glass-panel ${styles.catalog}`}
        aria-labelledby="marketplace-catalog-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="marketplace-catalog-title">Каталог и тематики</h2>
            <p>
              Укажите, сколько отдельных раскрасок продаётся в одной единице
              товара. Несколько карточек могут относиться к одной тематике.
            </p>
          </div>
          <span className={styles.count}>
            {data.products.length} карточек · {unmapped} без тематики
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} />
            Обновить список
          </Button>
        </div>
        {!data.products.length ? (
          <EmptyState
            title="Каталог ещё не загружен"
            description="Подключите маркетплейс и загрузите данные. После этого сопоставьте его товары с тематиками WMS."
          />
        ) : !workspace.data ? (
          <ErrorState
            message="Не удалось получить тематики склада. Соответствия недоступны до загрузки справочника."
            onRetry={() => void workspace.refetch()}
          />
        ) : (
          data.products.map((product) => (
            <ProductMapping
              key={`${product.provider}:${product.externalId}:${product.skuId}:${product.unitsPerItem}`}
              product={product}
              skus={skus}
              pending={actions.pending}
              onSave={async (values) => {
                const success = await actions.map(
                  mappingPayload(product, values),
                );
                if (success)
                  setNotice(`Соответствие для «${product.name}» сохранено.`);
                return success;
              }}
            />
          ))
        )}
      </section>
      <p className={styles.footnote}>
        Загрузка запускается вручную. Сохранение ключа не подтверждает доступ к
        API. При ошибке прежние данные сохраняются и помечаются; неполные данные
        не становятся нулевыми остатками.
      </p>
    </div>
  );
}
