package growth

import "math"

// interpolateLMS returns interpolated L, M, S for a given age in months.
func interpolateLMS(ageMonths int, table []LMSPoint) (l, m, s float64, ok bool) {
	if len(table) == 0 {
		return 0, 0, 0, false
	}
	// Clamp to table range
	if ageMonths <= table[0].AgeMonths {
		p := table[0]
		return p.L, p.M, p.S, true
	}
	last := table[len(table)-1]
	if ageMonths >= last.AgeMonths {
		return last.L, last.M, last.S, true
	}
	// Linear interpolation between adjacent points
	for i := 1; i < len(table); i++ {
		if ageMonths <= table[i].AgeMonths {
			lo, hi := table[i-1], table[i]
			t := float64(ageMonths-lo.AgeMonths) / float64(hi.AgeMonths-lo.AgeMonths)
			return lo.L + t*(hi.L-lo.L),
				lo.M + t*(hi.M-lo.M),
				lo.S + t*(hi.S-lo.S),
				true
		}
	}
	return 0, 0, 0, false
}

// zScore computes the WHO LMS z-score.
func zScore(value, l, m, s float64) float64 {
	if l == 0 {
		return math.Log(value/m) / s
	}
	return (math.Pow(value/m, l) - 1) / (l * s)
}

// normCDF is the standard normal cumulative distribution function.
func normCDF(z float64) float64 {
	return 0.5 * math.Erfc(-z/math.Sqrt2)
}

// normPPF approximates the inverse normal CDF (percent-point function).
// Beasley-Springer-Moro algorithm — accurate to ~1e-4.
func normPPF(p float64) float64 {
	a := [4]float64{2.515517, 0.802853, 0.010328, 0}
	b := [4]float64{1.432788, 0.189269, 0.001308, 0}
	sign := 1.0
	if p < 0.5 {
		p = 1 - p
		sign = -1
	}
	t := math.Sqrt(-2 * math.Log(1-p))
	num := a[0] + t*(a[1]+t*(a[2]+t*a[3]))
	den := 1 + t*(b[0]+t*(b[1]+t*(b[2]+t*b[3])))
	return sign * (t - num/den)
}

// PercentileResult holds height and weight percentile/z-score results.
type PercentileResult struct {
	HeightPercentile float64 `json:"heightPercentile"`
	HeightZScore     float64 `json:"heightZScore"`
	WeightPercentile float64 `json:"weightPercentile"`
	WeightZScore     float64 `json:"weightZScore"`
}

// CalcPercentile computes WHO percentiles for height and weight.
func CalcPercentile(gender string, ageMonths int, heightCm, weightKg float64) PercentileResult {
	var res PercentileResult

	hTable := getLMSTable(gender, "height")
	if l, m, s, ok := interpolateLMS(ageMonths, hTable); ok && heightCm > 0 {
		z := zScore(heightCm, l, m, s)
		res.HeightZScore = math.Round(z*100) / 100
		res.HeightPercentile = math.Round(normCDF(z)*1000) / 10
	}

	wTable := getLMSTable(gender, "weight")
	if l, m, s, ok := interpolateLMS(ageMonths, wTable); ok && weightKg > 0 {
		z := zScore(weightKg, l, m, s)
		res.WeightZScore = math.Round(z*100) / 100
		res.WeightPercentile = math.Round(normCDF(z)*1000) / 10
	}

	return res
}

// CurvePoint is a single (age, value) point on a WHO percentile curve.
type CurvePoint struct {
	AgeMonths int     `json:"x"`
	Value     float64 `json:"y"`
}

// GrowthCurves holds all standard WHO percentile bands.
type GrowthCurves struct {
	P3  []CurvePoint `json:"p3"`
	P10 []CurvePoint `json:"p10"`
	P25 []CurvePoint `json:"p25"`
	P50 []CurvePoint `json:"p50"`
	P75 []CurvePoint `json:"p75"`
	P90 []CurvePoint `json:"p90"`
	P97 []CurvePoint `json:"p97"`
}

// valueAtPercentile computes the measurement value corresponding to a z-score.
func valueAtZScore(z, l, m, s float64) float64 {
	if l == 0 {
		return m * math.Exp(z*s)
	}
	base := 1 + l*s*z
	if base <= 0 {
		return 0
	}
	return m * math.Pow(base, 1/l)
}

// CalcGrowthCurves returns WHO percentile curves for the given gender and measurement type.
// fromMonths/toMonths define the age range; step is months per point.
func CalcGrowthCurves(gender, measureType string, fromMonths, toMonths, step int) GrowthCurves {
	table := getLMSTable(gender, measureType)
	zs := map[string]float64{
		"p3":  standardZScores["p3"],
		"p10": standardZScores["p10"],
		"p25": standardZScores["p25"],
		"p50": standardZScores["p50"],
		"p75": standardZScores["p75"],
		"p90": standardZScores["p90"],
		"p97": standardZScores["p97"],
	}

	curves := map[string]*[]CurvePoint{
		"p3":  {},
		"p10": {},
		"p25": {},
		"p50": {},
		"p75": {},
		"p90": {},
		"p97": {},
	}
	for k := range curves {
		slice := make([]CurvePoint, 0, (toMonths-fromMonths)/step+1)
		curves[k] = &slice
	}

	for age := fromMonths; age <= toMonths; age += step {
		l, m, s, ok := interpolateLMS(age, table)
		if !ok {
			continue
		}
		for name, z := range zs {
			v := math.Round(valueAtZScore(z, l, m, s)*10) / 10
			*curves[name] = append(*curves[name], CurvePoint{AgeMonths: age, Value: v})
		}
	}

	return GrowthCurves{
		P3:  *curves["p3"],
		P10: *curves["p10"],
		P25: *curves["p25"],
		P50: *curves["p50"],
		P75: *curves["p75"],
		P90: *curves["p90"],
		P97: *curves["p97"],
	}
}
