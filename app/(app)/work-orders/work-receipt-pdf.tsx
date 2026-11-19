import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

/**
 * The work receipt ("werkbon", issue #226) PDF layout - a plain
 * `@react-pdf/renderer` document, styled consistently with
 * `app/(app)/quotes/invoice-pdf.tsx`. Pure layout: every value is formatted by
 * the caller (`./work-receipt-render.ts`), no `Intl` calls and no data access
 * here. Not a "use server" file.
 */

export interface WorkReceiptPdfAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface WorkReceiptPdfTimelineStep {
  title: string;
  /** Pre-formatted date/time (or range), `null` when not recorded. */
  when: string | null;
  /** Secondary line(s): who, totals. */
  details: string[];
}

export interface WorkReceiptPdfAssetNode {
  name: string;
  serialNumber: string | null;
  quantity: number | null;
  depth: number;
  isCurrent: boolean;
}

export interface WorkReceiptPdfProps {
  receiptNumber: string;
  generatedAtLabel: string;
  sender: {
    name: string;
    kvkNumber: string | null;
    vatNumber: string | null;
    address: WorkReceiptPdfAddress | null;
    logoUrl: string | null;
  };
  client: { name: string };
  site: {
    name: string | null;
    address: WorkReceiptPdfAddress | null;
    visitContact: string | null;
  };
  workOrder: {
    number: string;
    type: string | null;
    priority: string | null;
    externalReference: string | null;
    description: string | null;
  };
  asset: {
    name: string;
    serialNumber: string | null;
    brand: string | null;
    model: string | null;
    type: string | null;
    subtype: string | null;
    installedOn: string | null;
    warrantyUntil: string | null;
    externalReference: string | null;
    /** Component tree (flattened, depth-first) when the asset is composite. */
    components: WorkReceiptPdfAssetNode[];
  } | null;
  timeline: WorkReceiptPdfTimelineStep[];
  solution: string | null;
  hours: { type: string; date: string; duration: string; engineer: string }[];
  hoursTotals: { work: string; travel: string } | null;
  materials: { article: string; quantity: string }[];
  volumes: { counter: string; value: string; readAt: string }[];
  photoCount: number;
  signature: { data: Buffer; signedAtLabel: string } | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  logo: { width: 120, maxHeight: 60, objectFit: "contain" },
  brandFallback: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  headerRight: { alignItems: "flex-end" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  receiptNumber: { fontSize: 10, color: "#555555", marginTop: 2 },
  receiptDate: { fontSize: 8, color: "#8a8a8a", marginTop: 2 },
  partiesRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  partyColumn: { width: "48%" },
  label: { fontSize: 7, color: "#8a8a8a", letterSpacing: 0.5, marginBottom: 4 },
  partyName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  partyLine: { fontSize: 9, color: "#333333", marginBottom: 1 },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: "#dddddd",
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
    paddingVertical: 10,
    marginBottom: 16,
  },
  metaItem: { marginRight: 28 },
  metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 2 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  bodyText: { fontSize: 9, color: "#333333", lineHeight: 1.4 },
  mutedText: { fontSize: 8, color: "#8a8a8a" },
  kvRow: { flexDirection: "row", marginBottom: 3 },
  kvKey: { width: 110, fontSize: 8, color: "#8a8a8a" },
  kvValue: { flexGrow: 1, flexShrink: 1, fontSize: 9 },
  treeRow: { flexDirection: "row", marginBottom: 2 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f4f4f4", paddingVertical: 6, paddingHorizontal: 4 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eeeeee",
  },
  tableHeaderText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#666666", letterSpacing: 0.5 },
  cellText: { fontSize: 9 },
  colWide: { width: "40%", paddingRight: 4 },
  colMid: { width: "25%", paddingRight: 4 },
  colNarrow: { width: "15%", paddingRight: 4 },
  colRight: { width: "20%", textAlign: "right" },
  timelineStep: { flexDirection: "row" },
  timelineRail: { width: 16, alignItems: "center" },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#1a1a1a", marginTop: 2 },
  timelineLine: { width: 1, flexGrow: 1, backgroundColor: "#cccccc", marginTop: 2 },
  timelineBody: { flexGrow: 1, flexShrink: 1, paddingBottom: 10 },
  timelineTitle: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  timelineWhen: { fontSize: 8, color: "#555555", marginTop: 1 },
  timelineDetail: { fontSize: 8, color: "#8a8a8a", marginTop: 1 },
  signatureImage: { width: 200, height: 80, objectFit: "contain", borderBottomWidth: 1, borderBottomColor: "#999999" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#dddddd",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: "#999999" },
});

function addressLines(address: WorkReceiptPdfAddress | null): string[] {
  if (!address) return [];
  const line1 = [address.line1, address.line2].filter(Boolean).join(", ");
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [line1, cityLine, address.country ?? ""].filter((line) => line !== "");
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} style={styles.partyLine}>
          {line}
        </Text>
      ))}
    </>
  );
}

function KeyValue({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

export function WorkReceiptDocument(props: WorkReceiptPdfProps) {
  const { sender, client, site, workOrder, asset } = props;
  const siteLines = addressLines(site.address);

  return (
    <Document title={`Work receipt ${props.receiptNumber}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerRow}>
          {sender.logoUrl ? (
            // @react-pdf/renderer's Image fetches a remote URL itself. This is
            // a PDF-only component, not an HTML <img>, so jsx-a11y does not apply.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={sender.logoUrl} style={styles.logo} />
          ) : (
            <Text style={styles.brandFallback}>{sender.name}</Text>
          )}
          <View style={styles.headerRight}>
            <Text style={styles.title}>Work receipt</Text>
            <Text style={styles.receiptNumber}>{props.receiptNumber}</Text>
            <Text style={styles.receiptDate}>Generated {props.generatedAtLabel}</Text>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <View style={styles.partyColumn}>
            <Text style={styles.label}>FROM</Text>
            <Text style={styles.partyName}>{sender.name}</Text>
            <Lines lines={addressLines(sender.address)} />
            {sender.kvkNumber ? <Text style={styles.partyLine}>KvK {sender.kvkNumber}</Text> : null}
            {sender.vatNumber ? <Text style={styles.partyLine}>VAT {sender.vatNumber}</Text> : null}
          </View>
          <View style={styles.partyColumn}>
            <Text style={styles.label}>CLIENT</Text>
            <Text style={styles.partyName}>{client.name}</Text>
            {site.name || siteLines.length > 0 ? (
              <>
                <Text style={[styles.label, { marginTop: 6 }]}>SITE</Text>
                {site.name ? <Text style={styles.partyLine}>{site.name}</Text> : null}
                <Lines lines={siteLines} />
              </>
            ) : null}
            {site.visitContact ? (
              <>
                <Text style={[styles.label, { marginTop: 6 }]}>SITE VISIT CONTACT</Text>
                <Text style={styles.partyLine}>{site.visitContact}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.label}>WORK ORDER</Text>
            <Text style={styles.metaValue}>{workOrder.number}</Text>
          </View>
          {workOrder.type ? (
            <View style={styles.metaItem}>
              <Text style={styles.label}>TYPE</Text>
              <Text style={styles.metaValue}>{workOrder.type}</Text>
            </View>
          ) : null}
          {workOrder.priority ? (
            <View style={styles.metaItem}>
              <Text style={styles.label}>PRIORITY</Text>
              <Text style={styles.metaValue}>{workOrder.priority}</Text>
            </View>
          ) : null}
          {workOrder.externalReference ? (
            <View style={styles.metaItem}>
              <Text style={styles.label}>EXTERNAL REFERENCE</Text>
              <Text style={styles.metaValue}>{workOrder.externalReference}</Text>
            </View>
          ) : null}
        </View>

        {workOrder.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.bodyText}>{workOrder.description}</Text>
          </View>
        ) : null}

        {asset ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Asset</Text>
            <KeyValue label="Name" value={asset.name} />
            <KeyValue label="Serial number" value={asset.serialNumber} />
            <KeyValue label="Brand" value={asset.brand} />
            <KeyValue label="Model" value={asset.model} />
            <KeyValue label="Type" value={[asset.type, asset.subtype].filter(Boolean).join(" / ") || null} />
            <KeyValue label="Installed on" value={asset.installedOn} />
            <KeyValue label="Warranty until" value={asset.warrantyUntil} />
            <KeyValue label="External reference" value={asset.externalReference} />
            {asset.components.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.label}>COMPONENTS</Text>
                {asset.components.map((node, index) => (
                  <View key={index} style={[styles.treeRow, { paddingLeft: node.depth * 14 }]}>
                    <Text style={[styles.cellText, node.isCurrent ? { fontFamily: "Helvetica-Bold" } : {}]}>
                      {node.depth > 0 ? "- " : ""}
                      {node.name}
                      {node.serialNumber ? ` (SN ${node.serialNumber})` : ""}
                      {node.quantity !== null && node.quantity !== 1 ? ` x${node.quantity}` : ""}
                      {node.isCurrent ? "  < this asset" : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {props.timeline.map((step, index) => (
            <View key={index} style={styles.timelineStep} wrap={false}>
              <View style={styles.timelineRail}>
                <View style={styles.timelineDot} />
                {index < props.timeline.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.timelineTitle}>{step.title}</Text>
                {step.when ? <Text style={styles.timelineWhen}>{step.when}</Text> : null}
                {step.details.map((detail, detailIndex) => (
                  <Text key={detailIndex} style={styles.timelineDetail}>
                    {detail}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>

        {props.solution ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Solution</Text>
            <Text style={styles.bodyText}>{props.solution}</Text>
          </View>
        ) : null}

        {props.hours.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hours</Text>
            <View style={styles.tableHeaderRow} wrap={false}>
              <Text style={[styles.tableHeaderText, styles.colNarrow]}>TYPE</Text>
              <Text style={[styles.tableHeaderText, styles.colMid]}>DATE</Text>
              <Text style={[styles.tableHeaderText, styles.colWide]}>ENGINEER</Text>
              <Text style={[styles.tableHeaderText, { width: "20%", textAlign: "right" }]}>DURATION</Text>
            </View>
            {props.hours.map((row, index) => (
              <View key={index} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cellText, styles.colNarrow]}>{row.type}</Text>
                <Text style={[styles.cellText, styles.colMid]}>{row.date}</Text>
                <Text style={[styles.cellText, styles.colWide]}>{row.engineer}</Text>
                <Text style={[styles.cellText, styles.colRight]}>{row.duration}</Text>
              </View>
            ))}
            {props.hoursTotals ? (
              <Text style={[styles.mutedText, { marginTop: 4, textAlign: "right" }]}>
                Total work {props.hoursTotals.work} / travel {props.hoursTotals.travel}
              </Text>
            ) : null}
          </View>
        ) : null}

        {props.materials.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Materials</Text>
            <View style={styles.tableHeaderRow} wrap={false}>
              <Text style={[styles.tableHeaderText, { width: "80%" }]}>ARTICLE</Text>
              <Text style={[styles.tableHeaderText, { width: "20%", textAlign: "right" }]}>QUANTITY</Text>
            </View>
            {props.materials.map((row, index) => (
              <View key={index} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cellText, { width: "80%", paddingRight: 4 }]}>{row.article}</Text>
                <Text style={[styles.cellText, { width: "20%", textAlign: "right" }]}>{row.quantity}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {props.volumes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Volumes</Text>
            <View style={styles.tableHeaderRow} wrap={false}>
              <Text style={[styles.tableHeaderText, { width: "45%" }]}>COUNTER</Text>
              <Text style={[styles.tableHeaderText, { width: "25%", textAlign: "right", paddingRight: 8 }]}>VALUE</Text>
              <Text style={[styles.tableHeaderText, { width: "30%" }]}>READ AT</Text>
            </View>
            {props.volumes.map((row, index) => (
              <View key={index} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cellText, { width: "45%", paddingRight: 4 }]}>{row.counter}</Text>
                <Text style={[styles.cellText, { width: "25%", textAlign: "right", paddingRight: 8 }]}>{row.value}</Text>
                <Text style={[styles.cellText, { width: "30%" }]}>{row.readAt}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {props.photoCount > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <Text style={styles.bodyText}>
              {props.photoCount} {props.photoCount === 1 ? "photo" : "photos"} registered on this work order.
            </Text>
          </View>
        ) : null}

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Signature</Text>
          {props.signature ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image src={{ data: props.signature.data, format: "png" }} style={styles.signatureImage} />
              <Text style={[styles.mutedText, { marginTop: 4 }]}>Signed on {props.signature.signedAtLabel}</Text>
            </>
          ) : (
            <Text style={styles.mutedText}>No signature was captured for this work order.</Text>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {sender.name}
            {sender.kvkNumber ? ` · KvK ${sender.kvkNumber}` : ""}
            {sender.vatNumber ? ` · VAT ${sender.vatNumber}` : ""}
            {` · ${props.receiptNumber}`}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
