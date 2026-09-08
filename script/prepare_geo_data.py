#!/usr/bin/env python3
"""Convert the provided Barwani shapefile ZIPs into browser-ready GeoJSON."""

from __future__ import annotations

import json
import math
import re
import struct
from collections import Counter
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path("/home/asa/Downloads")
OUT_DIR = ROOT / "public" / "data" / "barwani"

SOURCES = {
    "poi": SOURCE_DIR / "POI_wrd_Interventions.zip",
    "blocks": SOURCE_DIR / "Barwani_Dist_Blc_BDY.zip",
    "villages": SOURCE_DIR / "Barwani_district_vill_BDY_SSiDP.zip",
}

BLOCK_ALIASES = {
    "sendhawa": "Sendhwa",
}


def read_zip_member(zip_path: Path, suffix: str) -> bytes:
    with ZipFile(zip_path) as archive:
        member = next(name for name in archive.namelist() if name.lower().endswith(suffix))
        return archive.read(member)


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


def manifest(block_features: list[dict[str, object]], village_features: list[dict[str, object]], poi_features: list[dict[str, object]], district_bbox: list[float]) -> dict[str, object]:
    activity_counts = Counter(feature["properties"]["activity"] for feature in poi_features)
    block_counts = Counter(feature["properties"].get("block") or "Unassigned" for feature in poi_features)
    village_counts = Counter(feature["properties"].get("block") for feature in village_features)

    return {
        "district": "Barwani",
        "bbox": district_bbox,
        "files": {
            "blocks": "/data/barwani/blocks.geojson",
            "villages": "/data/barwani/villages.geojson",
            "pois": "/data/barwani/poi_wrd_interventions.geojson",
        },
        "source_files": {key: str(path) for key, path in SOURCES.items()},
        "counts": {
            "blocks": len(block_features),
            "villages": len(village_features),
            "interventions": len(poi_features),
            "pois": len(poi_features),
            "poi_source_records": len(read_dbf(SOURCES["poi"])),
        },
        "projects": {
            "LWRD Interventions": len(poi_features),
        },
        "activity_counts": dict(sorted(activity_counts.items())),
        "poi_block_counts": dict(sorted(block_counts.items())),
        "village_block_counts": dict(sorted(village_counts.items())),
        "verticals": [
            {"name": "WRD", "label": "Water Resources", "poi_count": len(poi_features)},
            {"name": "Agriculture", "label": "Agriculture", "poi_count": 0},
        ],
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

    write_geojson("blocks.geojson", feature_collection(block_features, district_bbox))
    write_geojson("villages.geojson", feature_collection(village_features, district_bbox))
    write_geojson("poi_wrd_interventions.geojson", feature_collection(poi_features, district_bbox))
    write_json("manifest.json", manifest(block_features, village_features, poi_features, district_bbox))

    print(f"Generated {len(block_features)} blocks")
    print(f"Generated {len(village_features)} villages")
    print(f"Generated {len(poi_features)} Barwani interventions")


if __name__ == "__main__":
    main()
