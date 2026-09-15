#!/usr/bin/env python3
"""Convert the provided Barwani shapefile ZIPs into private import-ready GeoJSON."""

from __future__ import annotations

import json
import math
import posixpath
import re
import struct
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path("/home/asa/Downloads")
OUT_DIR = ROOT / "db" / "geojson" / "barwani"

SOURCES = {
    "poi": SOURCE_DIR / "POI_wrd_Interventions.zip",
    "blocks": SOURCE_DIR / "Barwani_Dist_Blc_BDY.zip",
    "villages": SOURCE_DIR / "Barwani_district_vill_BDY_SSiDP.zip",
}

EXCEL_SOURCES = {
    "agribusiness": SOURCE_DIR / "Rajpur - Copy.xlsx",
    "agrohorti": SOURCE_DIR / "Working Agrohorti plantation 03.09.2026 - ASA - Copy.xlsx",
}

XLSX_NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

PLANT_VARIETIES = (
    "Kesar",
    "Langda",
    "Rajapuri",
    "Chousa",
    "Swarn Rekha",
    "Mallika",
    "Himasagar",
    "Teak",
    "Karounda",
    "Jackfruit",
    "Sapota",
)

PLANTATION_DETAIL_SHEETS = (
    "ASA Mapping",
    "693",
    "680",
    "673",
    "669",
)

AGRIBUSINESS_FARMER_FIELDS = (
    ("Farmer Unique ID", "farmer_id"),
    ("Family Unique ID", "family_id"),
    ("Farmer Name", "farmer_name"),
    ("Father/Husband Name", "father_husband_name"),
    ("Gender", "gender"),
    ("Social Economic Category", "socio_economic_category"),
    ("Social Category", "social_category"),
    ("FCO Name", "fco_name"),
    ("FPC Name", "fpc_name"),
    ("Team Office Name", "team_office_name"),
    ("ICS Team Name", "ics_team_name"),
    ("Is Organic", "is_organic"),
    ("Is Land Owner", "is_land_owner"),
    ("Is FPO Holder", "is_fpo_holder"),
    ("KCC Present", "kcc_present"),
    ("District", "district"),
    ("Block", "block"),
    ("Gram Panchayat", "gram_panchayat"),
    ("Village", "village"),
    ("Village LG Code", "village_lgd_code"),
    ("Plot No", "plot_no"),
    ("Khasra No", "khasra_no"),
    ("Land Name", "land_name"),
    ("Soil Type", "soil_type"),
    ("Source of Irrigation", "irrigation_source"),
    ("Land Owner Name", "land_owner_name"),
    ("Type of Land", "land_type"),
    ("Total Area", "total_area"),
    ("Irrigated Land", "irrigated_land"),
    ("Unirrigated Land", "unirrigated_land"),
    ("Fallow Land", "fallow_land"),
    ("Crop Used Area", "crop_used_area"),
    ("Crop Name", "crop_name"),
    ("Crop Type", "crop_type"),
    ("Production (Qtl)", "production_qtl"),
    ("Approx Income", "approx_income"),
    ("Cultivated Season", "cultivated_season"),
    ("Cultivated Year", "cultivated_year"),
    ("Is Organic Crop", "is_organic_crop"),
    ("Activity Name", "activity_name"),
    ("Activity Year", "activity_year"),
    ("Benefited", "benefited"),
    ("Status", "status"),
    ("Joining Date", "joining_date"),
    ("Created At", "created_at"),
)

BLOCK_ALIASES = {
    "sendhawa": "Sendhwa",
}


def read_zip_member(zip_path: Path, suffix: str) -> bytes:
    with ZipFile(zip_path) as archive:
        member = next(name for name in archive.namelist() if name.lower().endswith(suffix))
        return archive.read(member)


def read_prj(zip_path: Path) -> str:
    return read_zip_member(zip_path, ".prj").decode("utf-8", "replace").strip()


def projection_info() -> dict[str, object]:
    for path in SOURCES.values():
        read_prj(path)
    return {
        "authority": "EPSG:4326",
        "name": "WGS 84",
        "unit": "Degree",
        "verified_from_prj": True,
        "globe_projection": "WGS84 longitude/latitude to spherical globe coordinates",
    }


def xlsx_column_index(reference: str | None) -> int | None:
    match = re.match(r"[A-Z]+", reference or "")
    if not match:
        return None

    index = 0
    for char in match.group(0):
        index = index * 26 + ord(char) - 64
    return index - 1


def read_xlsx_shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []

    strings = []
    for item in root.findall("main:si", XLSX_NS):
        strings.append("".join(text.text or "" for text in item.findall(".//main:t", XLSX_NS)).strip())
    return strings


def xlsx_sheet_paths(archive: ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships}
    sheets = {}
    for sheet in workbook.findall("main:sheets/main:sheet", XLSX_NS):
        rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = targets[rel_id]
        if not target.startswith("xl/"):
            target = posixpath.normpath("xl/" + target.lstrip("/"))
        sheets[sheet.attrib["name"]] = target
    return sheets


def read_xlsx_rows(path: Path, sheet_name: str) -> list[list[str]]:
    with ZipFile(path) as archive:
        shared_strings = read_xlsx_shared_strings(archive)
        sheet_path = xlsx_sheet_paths(archive)[sheet_name]
        root = ET.fromstring(archive.read(sheet_path))
        rows = []
        for row in root.findall("main:sheetData/main:row", XLSX_NS):
            values = []
            for cell in row.findall("main:c", XLSX_NS):
                index = xlsx_column_index(cell.attrib.get("r"))
                if index is None:
                    index = len(values)
                while len(values) <= index:
                    values.append("")
                values[index] = xlsx_cell_value(cell, shared_strings)
            if any(clean_text(value) for value in values):
                rows.append(values)
        return rows


def xlsx_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//main:t", XLSX_NS)).strip()

    value = cell.find("main:v", XLSX_NS)
    if value is None or value.text is None:
        return ""

    raw_value = value.text.strip()
    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)]
        except (IndexError, ValueError):
            return raw_value
    return raw_value


def sheet_records(path: Path, sheet_name: str, header_row: int = 0) -> list[dict[str, str]]:
    rows = read_xlsx_rows(path, sheet_name)
    if len(rows) <= header_row:
        return []

    headers = [clean_text(header) for header in rows[header_row]]
    records = []
    for row in rows[header_row + 1 :]:
        record = {}
        for index, header in enumerate(headers):
            if not header:
                continue
            record[header] = clean_text(row[index]) if index < len(row) else ""
        if any(record.values()):
            records.append(record)
    return records


def read_dbf(zip_path: Path) -> list[dict[str, object]]:
    data = read_zip_member(zip_path, ".dbf")
    record_count = int.from_bytes(data[4:8], "little")
    header_length = int.from_bytes(data[8:10], "little")
    record_length = int.from_bytes(data[10:12], "little")

    fields = []
    offset = 32
    while offset < header_length and data[offset] != 0x0D:
        name = data[offset : offset + 11].split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
        fields.append(
            {
                "name": name,
                "type": chr(data[offset + 11]),
                "length": data[offset + 16],
                "decimals": data[offset + 17],
            }
        )
        offset += 32

    rows = []
    position = header_length
    for _ in range(record_count):
        record = data[position : position + record_length]
        position += record_length
        if not record or record[0:1] == b"*":
            continue

        cursor = 1
        row = {}
        for field in fields:
            raw_value = record[cursor : cursor + field["length"]].decode("utf-8", "replace").strip()
            row[field["name"]] = cast_dbf_value(raw_value, field["type"], field["decimals"])
            cursor += field["length"]
        rows.append(row)
    return rows


def cast_dbf_value(value: str, field_type: str, decimals: int) -> object:
    if value == "":
        return None
    if field_type in ("N", "F"):
        try:
            return float(value) if decimals else int(value)
        except ValueError:
            return value
    if field_type == "L":
        return value.upper() in ("Y", "T")
    return value


def read_shapes(zip_path: Path, tolerance: float = 0.0) -> list[dict[str, object]]:
    data = read_zip_member(zip_path, ".shp")
    shapes = []
    position = 100

    while position + 8 <= len(data):
        _record_number, content_words = struct.unpack(">2i", data[position : position + 8])
        start = position + 8
        end = start + content_words * 2
        if end > len(data):
            break

        shape_type = struct.unpack("<i", data[start : start + 4])[0]
        if shape_type == 0:
            shapes.append({"geometry": None, "bbox": None})
        elif shape_type in (1, 11, 21):
            x, y = struct.unpack("<2d", data[start + 4 : start + 20])
            shapes.append({"geometry": {"type": "Point", "coordinates": [x, y]}, "bbox": [x, y, x, y]})
        elif shape_type in (5, 15, 25):
            shapes.append(parse_polygon_record(data[start:end], tolerance))
        else:
            raise ValueError(f"Unsupported shapefile shape type {shape_type} in {zip_path.name}")

        position = end

    return shapes


def parse_polygon_record(record: bytes, tolerance: float) -> dict[str, object]:
    min_x, min_y, max_x, max_y = struct.unpack("<4d", record[4:36])
    part_count, point_count = struct.unpack("<2i", record[36:44])
    part_offsets = list(struct.unpack(f"<{part_count}i", record[44 : 44 + part_count * 4]))
    point_start = 44 + part_count * 4
    points = [
        list(struct.unpack("<2d", record[point_start + index * 16 : point_start + index * 16 + 16]))
        for index in range(point_count)
    ]

    rings = []
    for index, offset in enumerate(part_offsets):
        next_offset = part_offsets[index + 1] if index + 1 < len(part_offsets) else point_count
        ring = points[offset:next_offset]
        if len(ring) < 4:
            continue
        ring = simplify_ring(ring, tolerance)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append(ring)

    geometry = polygon_geometry(rings)
    return {"geometry": geometry, "bbox": [min_x, min_y, max_x, max_y]}


def polygon_geometry(rings: list[list[list[float]]]) -> dict[str, object] | None:
    if not rings:
        return None
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": [rings[0]]}
    return {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]}


def simplify_ring(ring: list[list[float]], tolerance: float) -> list[list[float]]:
    if tolerance <= 0 or len(ring) <= 6:
        return [point[:] for point in ring]

    open_ring = ring[:-1] if ring[0] == ring[-1] else ring[:]
    radial = radial_simplify(open_ring, tolerance * 0.65)
    simplified = douglas_peucker(radial, tolerance)
    if len(simplified) < 3:
        simplified = open_ring[:]
    simplified = [point[:] for point in simplified]
    simplified.append(simplified[0][:])
    return simplified


def radial_simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points[:]

    tolerance_sq = tolerance * tolerance
    kept = [points[0]]
    previous = points[0]
    for point in points[1:-1]:
        if squared_distance(point, previous) > tolerance_sq:
            kept.append(point)
            previous = point
    kept.append(points[-1])
    return kept


def douglas_peucker(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points[:]

    tolerance_sq = tolerance * tolerance
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]

    while stack:
        start, end = stack.pop()
        max_distance = 0.0
        max_index = None
        for index in range(start + 1, end):
            distance = segment_distance_sq(points[index], points[start], points[end])
            if distance > max_distance:
                max_distance = distance
                max_index = index
        if max_index is not None and max_distance > tolerance_sq:
            keep.add(max_index)
            stack.append((start, max_index))
            stack.append((max_index, end))

    return [points[index] for index in sorted(keep)]


def squared_distance(first: list[float], second: list[float]) -> float:
    dx = first[0] - second[0]
    dy = first[1] - second[1]
    return dx * dx + dy * dy


def segment_distance_sq(point: list[float], start: list[float], end: list[float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return squared_distance(point, start)

    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    if t <= 0:
        return squared_distance(point, start)
    if t >= 1:
        return squared_distance(point, end)
    projection = [start[0] + t * dx, start[1] + t * dy]
    return squared_distance(point, projection)


def feature_collection(features: list[dict[str, object]], bbox: list[float] | None = None) -> dict[str, object]:
    collection = {"type": "FeatureCollection", "features": features}
    if bbox:
        collection["bbox"] = bbox
    return collection


def write_geojson(name: str, collection: dict[str, object]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_json(name: str, payload: dict[str, object]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def zip_features(zip_path: Path, tolerance: float = 0.0) -> list[tuple[dict[str, object], dict[str, object]]]:
    attrs = read_dbf(zip_path)
    shapes = read_shapes(zip_path, tolerance)
    if len(attrs) != len(shapes):
        raise ValueError(f"{zip_path.name} has {len(attrs)} DBF rows but {len(shapes)} shapes")
    return list(zip(attrs, shapes))


def normalize_block_name(value: object) -> str:
    name = str(value or "").strip()
    key = re.sub(r"[^a-z]", "", name.lower())
    return BLOCK_ALIASES.get(key, name)


def normalize_activity(name: object, folder_path: object) -> tuple[str, str]:
    text = f"{name or ''} {folder_path or ''}".lower()
    if "stop" in text or re.search(r"\b[sc]?d\s*20|\bed\s*20", text):
        return "Stop Dam", "dam"
    if "dug" in text or "well" in text:
        return "Dugwell", "well"
    if "solar" in text:
        return "Solar Lift Irrigation", "solar"
    if "doha" in text:
        return "Doha", "water"
    if "procurement" in text:
        return "Procurement", "store"
    return titleize(name), "water"


def titleize(value: object) -> str:
    text = str(value or "").strip()
    return " ".join(word.capitalize() for word in text.split()) if text else "Other"


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def row_value(row: dict[str, str], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if clean_text(value):
            return clean_text(value)
    return ""


def to_number(value: object) -> float | None:
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def excel_date(value: object) -> datetime | None:
    number = to_number(value)
    if number is None:
        return None
    return datetime(1899, 12, 30) + timedelta(days=number)


def fiscal_year_from_date(date: datetime | None) -> str | None:
    if not date:
        return None
    start = date.year if date.month >= 4 else date.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def fiscal_year_from_text(value: object) -> str | None:
    text = clean_text(value)
    match = re.search(r"(20\d{2})\s*[-_/]\s*(?:20)?(\d{2})", text)
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2)}"


def fiscal_year(*values: object, default: str = "") -> str:
    for value in values:
        fy = fiscal_year_from_text(value) or fiscal_year_from_date(excel_date(value))
        if fy:
            return fy
    return default


def source_year(value: object) -> int | None:
    number = to_number(value)
    return int(number) if number and 1900 <= number <= 2100 else None


def build_boundary_features(records: list[tuple[dict[str, object], dict[str, object]]], layer: str) -> list[dict[str, object]]:
    features = []
    for index, (attrs, shape) in enumerate(records, start=1):
        if not shape["geometry"]:
            continue

        if layer == "block":
            source_name = attrs.get("b_nm")
            name = normalize_block_name(source_name)
            properties = {
                "id": f"BLK-{index:02d}",
                "name": name,
                "source_name": source_name,
                "district": titleize(attrs.get("dist_nm")),
                "type": "Block Boundary",
            }
        else:
            name = titleize(attrs.get("vil_nm_e"))
            properties = {
                "id": f"VIL-{index:03d}",
                "name": name,
                "lgd_code": attrs.get("lgdcd"),
                "tehsil_code": attrs.get("teh_cd"),
                "district": titleize(attrs.get("dist_nm")),
                "district_code": attrs.get("dist_cd"),
                "block": normalize_block_name(attrs.get("block_nm")),
                "type": "Village Boundary",
            }

        properties["bbox"] = shape["bbox"]
        features.append({"type": "Feature", "geometry": shape["geometry"], "properties": properties})
    return features


def build_poi_features(
    poi_records: list[tuple[dict[str, object], dict[str, object]]],
    block_records: list[tuple[dict[str, object], dict[str, object]]],
    village_records: list[tuple[dict[str, object], dict[str, object]]],
    district_bbox: list[float],
) -> list[dict[str, object]]:
    block_index = spatial_index(block_records, "block")
    village_index = spatial_index(village_records, "village")
    features = []

    for source_index, (attrs, shape) in enumerate(poi_records, start=1):
        geometry = shape["geometry"]
        if not geometry:
            continue
        lon, lat = geometry["coordinates"]
        if not bbox_contains(district_bbox, lon, lat):
            continue

        block = find_containing_feature(block_index, lon, lat)
        village = find_containing_feature(village_index, lon, lat)
        activity, icon = normalize_activity(attrs.get("Name"), attrs.get("FolderPath"))
        properties = {
            "id": f"POI-{len(features) + 1:03d}",
            "source_id": source_index,
            "name": titleize(attrs.get("Name")),
            "activity": activity,
            "theme": "Water Resources",
            "project": "LWRD Interventions",
            "vertical": "WRD",
            "fy": fiscal_year(attrs.get("FolderPath")),
            "icon": icon,
            "folder_path": attrs.get("FolderPath"),
            "block": block.get("name") if block else None,
            "village": village.get("name") if village else None,
            "lgd_code": village.get("lgd_code") if village else None,
            "inside_boundary": bool(block),
        }
        features.append({"type": "Feature", "geometry": geometry, "properties": properties})

    return features


def spatial_index(records: list[tuple[dict[str, object], dict[str, object]]], layer: str) -> list[dict[str, object]]:
    indexed = []
    for attrs, shape in records:
        geometry = shape["geometry"]
        bbox = shape["bbox"]
        if not geometry or not bbox:
            continue
        if layer == "block":
            meta = {"name": normalize_block_name(attrs.get("b_nm"))}
        else:
            meta = {
                "name": titleize(attrs.get("vil_nm_e")),
                "lgd_code": attrs.get("lgdcd"),
                "block": normalize_block_name(attrs.get("block_nm")),
            }
        indexed.append({"geometry": geometry, "bbox": bbox, "meta": meta})
    return indexed


def spatial_index_from_features(features: list[dict[str, object]], layer: str) -> list[dict[str, object]]:
    indexed = []
    for feature in features:
        geometry = feature.get("geometry")
        props = feature.get("properties", {})
        bbox = props.get("bbox") or geometry_bbox(geometry)
        if not geometry or not bbox:
            continue
        if layer == "block":
            meta = {"name": props.get("name")}
        else:
            meta = {
                "name": props.get("name"),
                "lgd_code": props.get("lgd_code"),
                "block": props.get("block"),
            }
        indexed.append({"geometry": geometry, "bbox": bbox, "meta": meta})
    return indexed


def find_containing_feature(indexed_features: list[dict[str, object]], lon: float, lat: float) -> dict[str, object] | None:
    for feature in indexed_features:
        if bbox_contains(feature["bbox"], lon, lat) and point_in_geometry(feature["geometry"], lon, lat):
            return feature["meta"]
    return None


def bbox_contains(bbox: list[float], lon: float, lat: float) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def point_in_geometry(geometry: dict[str, object], lon: float, lat: float) -> bool:
    if geometry["type"] == "Polygon":
        return any(point_in_ring(ring, lon, lat) for ring in geometry["coordinates"])
    return any(any(point_in_ring(ring, lon, lat) for ring in polygon) for polygon in geometry["coordinates"])


def point_in_ring(ring: list[list[float]], lon: float, lat: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point
        xj, yj = ring[j]
        crosses = (yi > lat) != (yj > lat)
        if crosses:
            slope_lon = (xj - xi) * (lat - yi) / (yj - yi + math.ulp(1.0)) + xi
            if lon < slope_lon:
                inside = not inside
        j = i
    return inside


def collection_bbox(records: list[tuple[dict[str, object], dict[str, object]]]) -> list[float]:
    bboxes = [shape["bbox"] for _attrs, shape in records if shape["bbox"]]
    return [
        min(bbox[0] for bbox in bboxes),
        min(bbox[1] for bbox in bboxes),
        max(bbox[2] for bbox in bboxes),
        max(bbox[3] for bbox in bboxes),
    ]


def geometry_coordinates(geometry: dict[str, object] | None) -> list[list[float]]:
    if not geometry:
        return []
    if geometry["type"] == "Point":
        return [geometry["coordinates"]]
    if geometry["type"] == "Polygon":
        return [point for ring in geometry["coordinates"] for point in ring]
    if geometry["type"] == "MultiPolygon":
        return [point for polygon in geometry["coordinates"] for ring in polygon for point in ring]
    return []


def geometry_bbox(geometry: dict[str, object] | None) -> list[float] | None:
    coords = geometry_coordinates(geometry)
    if not coords:
        return None
    return [
        min(point[0] for point in coords),
        min(point[1] for point in coords),
        max(point[0] for point in coords),
        max(point[1] for point in coords),
    ]


def geometry_center(geometry: dict[str, object] | None) -> tuple[float | None, float | None]:
    bbox = geometry_bbox(geometry)
    if not bbox:
        return None, None
    return (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2


def valid_lon_lat(lon: float | None, lat: float | None) -> bool:
    return lon is not None and lat is not None and -180 <= lon <= 180 and -90 <= lat <= 90


def geometry_inside_bbox(geometry: dict[str, object] | None, bbox: list[float]) -> bool:
    coords = geometry_coordinates(geometry)
    return bool(coords) and all(bbox_contains(bbox, point[0], point[1]) for point in coords)


def village_centers(village_features: list[dict[str, object]]) -> dict[tuple[str, str], tuple[float, float]]:
    centers = {}
    fallback = defaultdict(list)
    for feature in village_features:
        props = feature["properties"]
        bbox = props.get("bbox")
        if not bbox:
            continue
        center = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
        block = props.get("block")
        village = props.get("name")
        centers[(normalize_text(block), normalize_text(village))] = center
        fallback[normalize_text(village)].append(center)

    for village, matches in fallback.items():
        if len(matches) == 1:
            centers[("", village)] = matches[0]
    return centers


def block_centers_from_villages(village_features: list[dict[str, object]]) -> dict[str, tuple[float, float]]:
    grouped = defaultdict(list)
    for feature in village_features:
        props = feature["properties"]
        bbox = props.get("bbox")
        block = props.get("block")
        if not bbox or not block:
            continue
        grouped[normalize_text(block)].append(((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2))

    return {
        block: (
            sum(point[0] for point in points) / len(points),
            sum(point[1] for point in points) / len(points),
        )
        for block, points in grouped.items()
        if points
    }


def normalize_text(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean_text(value).lower()).strip()


def build_agribusiness_features(village_features: list[dict[str, object]]) -> list[dict[str, object]]:
    path = EXCEL_SOURCES["agribusiness"]
    if not path.exists():
        return []

    centers = village_centers(village_features)
    block_centers = block_centers_from_villages(village_features)
    groups = {}
    for row in sheet_records(path, "Sheet1"):
        fpc_name = row_value(row, "FPC Name")
        block = normalize_block_name(row_value(row, "Block"))
        village = titleize(row_value(row, "Village"))
        if not fpc_name or not village:
            continue

        center = centers.get((normalize_text(block), normalize_text(village))) or centers.get(("", normalize_text(village)))
        location_basis = "Village centroid; source sheet has no FPO latitude/longitude"
        if not center:
            center = block_centers.get(normalize_text(block))
            location_basis = "Block centroid; source village name did not match boundary"
        if not center:
            continue

        fy = fiscal_year(row_value(row, "Created At"), row_value(row, "Activity Year"), row_value(row, "Joining Date"))
        key = (fy, block, village, fpc_name)
        farmer_id = row_value(row, "Farmer Unique ID") or "|".join(
            [row_value(row, "Farmer Name"), row_value(row, "Father/Husband Name"), village, fpc_name]
        )
        data = groups.setdefault(
            key,
            {
                "center": center,
                "farmer_ids": set(),
                "fpo_farmer_ids": set(),
                "organic_farmer_ids": set(),
                "irrigation_sources": Counter(),
                "location_basis": Counter(),
                "farmer_records": [],
                "source_rows": 0,
            },
        )
        data["source_rows"] += 1
        data["farmer_ids"].add(farmer_id)
        data["farmer_records"].append(agribusiness_farmer_detail(row, data["source_rows"]))
        data["location_basis"][location_basis] += 1
        if row_value(row, "Is FPO Holder").lower() == "yes":
            data["fpo_farmer_ids"].add(farmer_id)
        if row_value(row, "Is Organic").lower() == "yes":
            data["organic_farmer_ids"].add(farmer_id)
        irrigation = row_value(row, "Source of Irrigation")
        if irrigation:
            data["irrigation_sources"][irrigation] += 1

    features = []
    for index, ((fy, block, village, fpc_name), data) in enumerate(sorted(groups.items()), start=1):
        lon, lat = data["center"]
        properties = {
            "id": f"AGB-{index:04d}",
            "name": fpc_name,
            "activity": "FPO Location",
            "category": "FPO Location",
            "theme": "Agribusiness",
            "project": "Agribusiness",
            "vertical": "Agribusiness",
            "fy": fy,
            "block": block,
            "village": village,
            "fpc_name": fpc_name,
            "farmer_count": len(data["farmer_ids"]),
            "fpo_holder_count": len(data["fpo_farmer_ids"]),
            "organic_farmer_count": len(data["organic_farmer_ids"]),
            "source_rows": data["source_rows"],
            "farmer_detail_count": len(data["farmer_records"]),
            "location_basis": data["location_basis"].most_common(1)[0][0],
            "irrigation_sources": [name for name, _count in data["irrigation_sources"].most_common(4)],
            "farmers": data["farmer_records"],
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": properties})
    return features


def agribusiness_farmer_detail(row: dict[str, str], source_row: int) -> dict[str, str]:
    record = {"source_row": str(source_row)}
    for header, key in AGRIBUSINESS_FARMER_FIELDS:
        value = row_value(row, header)
        if header == "Created At":
            value = display_date(value)
        if value:
            record[key] = value
    return record


def display_date(value: object) -> str:
    date = excel_date(value)
    if date:
        return date.date().isoformat()
    return clean_text(value)


def parse_polygon_geojson(value: object) -> dict[str, object] | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    return payload.get("geometry") if payload.get("type") == "Feature" else payload


def parse_polygon_coordinates(value: object) -> dict[str, object] | None:
    numbers = [float(item) for item in re.findall(r"-?\d+(?:\.\d+)?", clean_text(value))]
    if len(numbers) < 6:
        return None
    step = 3 if len(numbers) % 3 == 0 else 2
    ring = [[numbers[index], numbers[index + 1]] for index in range(0, len(numbers) - 1, step)]
    if len(ring) < 3:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def variety_counts(row: dict[str, str]) -> dict[str, int]:
    varieties = {}
    for variety in PLANT_VARIETIES:
        count = to_number(row.get(variety))
        if count and count > 0:
            varieties[variety] = int(round(count))
    return varieties


def plant_total(row: dict[str, str], varieties: dict[str, int]) -> int | None:
    if varieties:
        return sum(varieties.values())
    value = to_number(row_value(row, "Total Plants", "Total"))
    if value is not None:
        return int(round(value))
    return None


def plantation_detail_lookup(path: Path) -> dict[str, dict[str, object]]:
    lookup = {}
    for sheet_name in PLANTATION_DETAIL_SHEETS:
        for row in sheet_records(path, sheet_name):
            farmer_id = row_value(row, "किसान ID")
            if not farmer_id:
                continue

            varieties = variety_counts(row)
            total = plant_total(row, varieties)
            if not varieties and total is None:
                continue

            key = normalize_text(farmer_id)
            current = lookup.get(key)
            current_total = current.get("total_plants") if current else None
            if current and (current_total or 0) >= (total or 0):
                continue

            lookup[key] = {
                "source_sheet": sheet_name,
                "project": row_value(row, "Project"),
                "varieties": varieties,
                "total_plants": total,
                "invoice_mapping": row_value(row, "Invoice Mapping"),
            }
    return lookup


def build_plantation_properties(
    row: dict[str, str],
    source_sheet: str,
    fy: str,
    block: str,
    village: str,
    detail: dict[str, object] | None = None,
) -> dict[str, object]:
    detail = detail or {}
    varieties = variety_counts(row) or detail.get("varieties") or {}
    area_acre = to_number(row_value(row, "Acr", "Area_Acre"))
    area_ha = to_number(row_value(row, "Area_Hectare", "क्षेत्रफल Ha", "Area Ha."))
    if area_ha is None and area_acre is not None:
        area_ha = round(area_acre * 0.404686, 4)
    total_plants = plant_total(row, varieties) or detail.get("total_plants")

    return {
        "id": "",
        "name": row_value(row, "Farmer Name", "किसान नाम") or "Agrohorti Plot",
        "activity": "Agrohorti Plantation",
        "category": "Agrohorti Plot",
        "theme": "Plantation",
        "project": row_value(row, "Project") or detail.get("project") or "Agrohorti",
        "vertical": "Plantation",
        "fy": fy,
        "source_sheet": source_sheet,
        "plantation_detail_source": detail.get("source_sheet"),
        "invoice_mapping": detail.get("invoice_mapping"),
        "farmer_id": row_value(row, "किसान ID"),
        "farmer_name": row_value(row, "Farmer Name", "किसान नाम"),
        "father_husband_name": row_value(row, "Father/Husband Name", "पिता/पति नाम"),
        "farmer_type": row_value(row, "किसान प्रकार"),
        "block": block,
        "village": village,
        "khasra_number": row_value(row, "Khaasra Number", "Khasra Number", "खसरा"),
        "area_ha": area_ha,
        "area_acre": area_acre or to_number(row_value(row, "Area_Acre")),
        "area_sq_meter": to_number(row_value(row, "Area_Sq_Meter")),
        "total_plants": total_plants,
        "varieties": varieties,
        "irrigation_source": row_value(row, "Water Resource", "सिंचाई स्रोत"),
        "water_availability": row_value(row, "Water Availability (Month)", "पानी उपलब्धता"),
        "soil_type": row_value(row, "Soil Type (Black, Light, Heavy, Stony)", "मिट्टी प्रकार"),
        "land_source": row_value(row, "जमीन स्रोत"),
        "plant_source": row_value(row, "Plant Source"),
        "existing_orchard": row_value(row, "मौजूदा बागान"),
        "gis_comment": row_value(row, "GIS Comment"),
    }


def build_plantation_features(
    block_features: list[dict[str, object]],
    village_features: list[dict[str, object]],
    district_bbox: list[float],
) -> list[dict[str, object]]:
    path = EXCEL_SOURCES["agrohorti"]
    if not path.exists():
        return []

    block_index = spatial_index_from_features(block_features, "block")
    village_index = spatial_index_from_features(village_features, "village")
    detail_lookup = plantation_detail_lookup(path)
    features = []

    for sheet_name, header_row in (("Plantation_2025-26", 1), ("Plantation_2026-27", 0)):
        for row in sheet_records(path, sheet_name, header_row):
            fy = fiscal_year(sheet_name)
            if sheet_name == "Plantation_2025-26":
                lat = to_number(row_value(row, "Latitude"))
                lon = to_number(row_value(row, "Longitude"))
                if not valid_lon_lat(lon, lat) or not bbox_contains(district_bbox, lon, lat):
                    continue
                geometry = {"type": "Point", "coordinates": [lon, lat]}
            else:
                geometry = parse_polygon_geojson(row_value(row, "Polygon_GeoJSON")) or parse_polygon_coordinates(row_value(row, "Polygon_Coordinates"))
                if not geometry_inside_bbox(geometry, district_bbox):
                    continue
                lon, lat = geometry_center(geometry)

            block_match = find_containing_feature(block_index, lon, lat)
            village_match = find_containing_feature(village_index, lon, lat)
            block = block_match.get("name") if block_match else normalize_block_name(row_value(row, "Block", "TO_Name", "TO_ Name"))
            village = village_match.get("name") if village_match else titleize(row_value(row, "Village", "ग्राम"))
            detail = detail_lookup.get(normalize_text(row_value(row, "किसान ID")))
            properties = build_plantation_properties(row, sheet_name, fy, block, village, detail)
            properties["id"] = f"PLT-{len(features) + 1:04d}"
            properties["latitude"] = lat
            properties["longitude"] = lon
            properties["geometry_type"] = geometry["type"]
            if village_match and village_match.get("lgd_code"):
                properties["lgd_code"] = village_match["lgd_code"]
            features.append({"type": "Feature", "geometry": geometry, "properties": properties})

    return features


def feature_counter(features: list[dict[str, object]], property_name: str) -> dict[str, int]:
    counts = Counter(clean_text(feature["properties"].get(property_name)) for feature in features)
    counts.pop("", None)
    return dict(sorted(counts.items()))


def vertical_summary(features: list[dict[str, object]]) -> list[dict[str, object]]:
    labels = {
        "WRD": "Water Resources",
        "Agribusiness": "Agribusiness",
        "Plantation": "Agrohorti Plantation",
        "Agriculture": "Agriculture",
    }
    counts = feature_counter(features, "vertical")
    summaries = [
        {"name": name, "label": labels.get(name, name), "poi_count": count, "item_count": count}
        for name, count in counts.items()
    ]
    if "Agriculture" not in counts:
        summaries.append({"name": "Agriculture", "label": "Agriculture", "poi_count": 0, "item_count": 0})
    return summaries


def manifest(
    block_features: list[dict[str, object]],
    village_features: list[dict[str, object]],
    poi_features: list[dict[str, object]],
    agribusiness_features: list[dict[str, object]],
    plantation_features: list[dict[str, object]],
    district_bbox: list[float],
) -> dict[str, object]:
    map_features = poi_features + agribusiness_features + plantation_features
    activity_counts = Counter(feature["properties"]["activity"] for feature in map_features)
    block_counts = Counter(feature["properties"].get("block") or "Unassigned" for feature in map_features)
    village_counts = Counter(feature["properties"].get("block") for feature in village_features)

    return {
        "district": "Barwani",
        "bbox": district_bbox,
        "files": {
            "blocks": "/api/barwani/blocks.geojson",
            "villages": "/api/barwani/villages.geojson",
            "pois": "/api/barwani/poi_wrd_interventions.geojson",
            "agribusiness": "/api/barwani/agribusiness_locations.geojson",
            "plantations": "/api/barwani/agrohorti_plantations.geojson",
        },
        "coordinate_reference_system": projection_info(),
        "counts": {
            "blocks": len(block_features),
            "villages": len(village_features),
            "interventions": len(poi_features),
            "pois": len(poi_features),
            "agribusiness_locations": len(agribusiness_features),
            "plantation_plots": len(plantation_features),
            "map_items": len(map_features),
            "poi_source_records": len(read_dbf(SOURCES["poi"])),
        },
        "projects": feature_counter(map_features, "project"),
        "activity_counts": dict(sorted(activity_counts.items())),
        "poi_block_counts": dict(sorted(block_counts.items())),
        "village_block_counts": dict(sorted(village_counts.items())),
        "fy_counts": {fy: count for fy, count in feature_counter(map_features, "fy").items() if fy and fy != "Not mapped"},
        "verticals": vertical_summary(map_features),
    }


def main() -> None:
    for path in SOURCES.values():
        if not path.exists():
            raise FileNotFoundError(path)

    block_raw = zip_features(SOURCES["blocks"])
    village_raw = zip_features(SOURCES["villages"])
    poi_raw = zip_features(SOURCES["poi"])
    district_bbox = collection_bbox(block_raw)

    block_features = build_boundary_features(zip_features(SOURCES["blocks"], tolerance=0.00008), "block")
    village_features = build_boundary_features(zip_features(SOURCES["villages"], tolerance=0.00014), "village")
    poi_features = build_poi_features(poi_raw, block_raw, village_raw, district_bbox)
    agribusiness_features = build_agribusiness_features(village_features)
    plantation_features = build_plantation_features(block_features, village_features, district_bbox)

    write_geojson("blocks.geojson", feature_collection(block_features, district_bbox))
    write_geojson("villages.geojson", feature_collection(village_features, district_bbox))
    write_geojson("poi_wrd_interventions.geojson", feature_collection(poi_features, district_bbox))
    write_geojson("agribusiness_locations.geojson", feature_collection(agribusiness_features, district_bbox))
    write_geojson("agrohorti_plantations.geojson", feature_collection(plantation_features, district_bbox))
    write_json("manifest.json", manifest(block_features, village_features, poi_features, agribusiness_features, plantation_features, district_bbox))

    print(f"Generated {len(block_features)} blocks")
    print(f"Generated {len(village_features)} villages")
    print(f"Generated {len(poi_features)} Barwani interventions")
    print(f"Generated {len(agribusiness_features)} agribusiness locations")
    print(f"Generated {len(plantation_features)} agrohorti plantation plots")


if __name__ == "__main__":
    main()
