import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Plus, Search, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { deleteKb, deleteTag, getKb, getTags, saveKb, saveTag, type KbRow, type TagRow } from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Modal,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
  Toggle,
  useToast,
} from "../components/ui";
import { StringListInput } from "../components/pickers";

interface ArticleDraft {
  id?: string;
  title: string;
  slug?: string;
  summary: string;
  content: string;
  category: string;
  keywords: string[];
  published: boolean;
}

const blankArticle = (): ArticleDraft => ({
  title: "",
  summary: "",
  content: "",
  category: "general",
  keywords: [],
  published: true,
});

/**
 * Knowledge base and tags.
 *
 * These two are the highest-leverage things support staff own: `/kb` answers
 * questions, and the auto-answer feature reads the same articles, so a good
 * article written here removes the same question from the queue forever.
 */
export const KnowledgePage = () => {
  const { guildId } = useGuildMeta();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState("kb");
  const [search, setSearch] = useState("");
  const [article, setArticle] = useState<ArticleDraft | null>(null);
  const [tag, setTag] = useState<{ id?: string; name: string; content: string; aliases: string[] } | null>(null);

  const kb = useQuery({ queryKey: ["kb", guildId, search], queryFn: () => getKb(guildId, search) });
  const tags = useQuery({ queryKey: ["tags", guildId], queryFn: () => getTags(guildId) });

  const saveArticle = useMutation({
    mutationFn: (body: ArticleDraft) => saveKb(guildId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb", guildId] });
      setArticle(null);
      toast.push("success", "Article saved.");
    },
    onError: (error: unknown) => toast.push("error", error instanceof Error ? error.message : "Could not save."),
  });

  const removeArticle = useMutation({
    mutationFn: (id: string) => deleteKb(guildId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb", guildId] });
      toast.push("success", "Article deleted.");
    },
  });

  const saveTagMutation = useMutation({
    mutationFn: (body: { name: string; content: string; aliases: string[] }) => saveTag(guildId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", guildId] });
      setTag(null);
      toast.push("success", "Tag saved.");
    },
    onError: (error: unknown) => toast.push("error", error instanceof Error ? error.message : "Could not save."),
  });

  const removeTag = useMutation({
    mutationFn: (id: string) => deleteTag(guildId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", guildId] });
      toast.push("success", "Tag deleted.");
    },
  });

  const editArticle = (row: KbRow) =>
    setArticle({
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      content: row.content,
      category: row.category,
      keywords: row.keywords,
      published: row.published,
    });

  const editTag = (row: TagRow) => setTag({ id: row.id, name: row.name, content: row.content, aliases: row.aliases });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-400">
            Articles power <code className="text-ink-300">/kb</code> and the auto-answer feature. Tags are quick
            copy-paste replies for staff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (tab === "kb" ? setArticle(blankArticle()) : setTag({ name: "", content: "", aliases: [] }))}
          className="btn-primary text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> {tab === "kb" ? "New article" : "New tag"}
        </button>
      </header>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "kb", label: "Articles", badge: <Badge>{kb.data?.items.length ?? 0}</Badge> },
          { id: "tags", label: "Tags", badge: <Badge>{tags.data?.items.length ?? 0}</Badge> },
        ]}
      />

      {tab === "kb" && (
        <Card>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search articles"
              className="pl-9"
            />
          </div>

          <div className="mt-4">
            {kb.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner className="text-ink-500" />
              </div>
            ) : kb.data?.items.length ? (
              <div className="space-y-2">
                {kb.data.items.map((row) => (
                  <div key={row.id} className="flex items-start gap-3 rounded-lg border border-ink-700 bg-ink-850/50 px-4 py-3">
                    <button type="button" onClick={() => editArticle(row)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink-100">{row.title}</span>
                        <Badge>{row.category}</Badge>
                        {!row.published && <Badge tone="warning">draft</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-400">
                        {row.summary || row.content.slice(0, 160)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {row.views}
                        </span>
                        <span className="inline-flex items-center gap-1 text-emerald-400/80">
                          <ThumbsUp className="h-3 w-3" /> {row.helpful}
                        </span>
                        <span className="inline-flex items-center gap-1 text-red-400/80">
                          <ThumbsDown className="h-3 w-3" /> {row.unhelpful}
                        </span>
                        {row.keywords.length > 0 && <span>{row.keywords.length} keywords</span>}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => window.confirm(`Delete "${row.title}"?`) && removeArticle.mutate(row.id)}
                      className="btn-ghost h-8 w-8 shrink-0 p-0 text-ink-500 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen className="h-7 w-7" />}
                title="No articles yet"
                description="Start with your five most repeated questions — first layer problems, AMS jams, drying PLA, warranty steps, and where to find firmware."
                action={
                  <button type="button" onClick={() => setArticle(blankArticle())} className="btn-primary text-xs">
                    <Plus className="h-3.5 w-3.5" /> Write the first one
                  </button>
                }
              />
            )}
          </div>
        </Card>
      )}

      {tab === "tags" && (
        <Card description="Staff run /tag show name — the content is posted as-is.">
          {tags.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-ink-500" />
            </div>
          ) : tags.data?.items.length ? (
            <div className="space-y-2">
              {tags.data.items.map((row) => (
                <div key={row.id} className="flex items-start gap-3 rounded-lg border border-ink-700 bg-ink-850/50 px-4 py-3">
                  <button type="button" onClick={() => editTag(row)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-brand-300">/{row.name}</code>
                      <span className="text-[11px] text-ink-500">{row.uses} uses</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-400">{row.content}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Delete tag "${row.name}"?`) && removeTag.mutate(row.id)}
                    className="btn-ghost h-8 w-8 shrink-0 p-0 text-ink-500 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No tags yet" description="Tags are the fastest way to answer a repeated question." />
          )}
        </Card>
      )}

      {/* Article editor */}
      <Modal
        open={article !== null}
        onClose={() => setArticle(null)}
        title={article?.id ? "Edit article" : "New article"}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setArticle(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!article?.title || !article?.content || saveArticle.isPending}
              onClick={() => article && saveArticle.mutate(article)}
            >
              {saveArticle.isPending && <Spinner />}
              Save article
            </button>
          </>
        }
      >
        {article && (
          <div className="space-y-4">
            <Field label="Title">
              <TextInput value={article.title} onChange={(event) => setArticle({ ...article, title: event.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" hint="Used to group articles. e.g. printing, ams, software, orders.">
                <TextInput value={article.category} onChange={(event) => setArticle({ ...article, category: event.target.value })} />
              </Field>
              <Field label="Published" hint="Drafts are hidden from /kb and auto-answer.">
                <Toggle checked={article.published} onChange={(published) => setArticle({ ...article, published })} label="Visible to members" />
              </Field>
            </div>
            <Field label="Summary" hint="One line, shown in the auto-answer card.">
              <TextInput value={article.summary} onChange={(event) => setArticle({ ...article, summary: event.target.value })} />
            </Field>
            <Field label="Answer" hint="Discord markdown works here.">
              <TextArea
                value={article.content}
                onChange={(event) => setArticle({ ...article, content: event.target.value })}
                className="min-h-[220px]"
              />
            </Field>
            <Field
              label="Search keywords"
              hint="The strongest signal for matching. Add the words people actually type — including misspellings."
            >
              <StringListInput
                value={article.keywords}
                onChange={(keywords) => setArticle({ ...article, keywords })}
                placeholder="e.g. first layer, adhesion, not sticking"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Tag editor */}
      <Modal
        open={tag !== null}
        onClose={() => setTag(null)}
        title={tag?.id ? "Edit tag" : "New tag"}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTag(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!tag?.name || !tag?.content || saveTagMutation.isPending}
              onClick={() => tag && saveTagMutation.mutate(tag)}
            >
              {saveTagMutation.isPending && <Spinner />}
              Save tag
            </button>
          </>
        }
      >
        {tag && (
          <div className="space-y-4">
            <Field label="Name" hint="Lowercase, no spaces.">
              <TextInput value={tag.name} onChange={(event) => setTag({ ...tag, name: event.target.value })} />
            </Field>
            <Field label="Content">
              <TextArea value={tag.content} onChange={(event) => setTag({ ...tag, content: event.target.value })} className="min-h-[160px]" />
            </Field>
            <Field label="Aliases" hint="Other names that resolve to this tag.">
              <StringListInput value={tag.aliases} onChange={(aliases) => setTag({ ...tag, aliases })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default KnowledgePage;
