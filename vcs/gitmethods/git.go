package gitmethods

import (
	"io"
	"os/exec"
	"bytes"
	"strings"
	"regexp"

	"github.com/etsy/hound/config"
)
var filenameBlame map[string][]string = make(map[string][]string);


func GitBlameAllLines(filename string, repoObj *config.Repo, vcsdir string) [] string {
	// caching on the same request , maybe ?
	if blame, ok := filenameBlame[filename]; ok {
		return blame
	} 
	cmd := exec.Command(
	"git" , "blame" , "--",filename)
	cmd.Dir = "data/"+vcsdir

	r, _ := cmd.StdoutPipe()
	defer r.Close()
	_ = cmd.Start()
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	resultgit,_ := strings.TrimSpace(buf.String()), cmd.Wait()
	lines := strings.Split(resultgit, "\n");
	filenameBlame[filename] = lines;
	return lines;

}

func GitBlameLines(start int, filename string, repoObj *config.Repo, vcsdir string ) [3]string{
	lines :=GitBlameAllLines(filename, repoObj, vcsdir);

	if (start) > len(lines) {
		var res[3]string;
		return res
	}
	value := lines[start-1];
	value = strings.Replace(value, "^", "", 1);
	parts := strings.SplitN(value, "(", 2);
	otherParts := strings.SplitN(parts[1],")",2);
	reg := regexp.MustCompile(`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [-+]\d{4}`);
	matches :=reg.FindAllString(otherParts[0], -1)
	name := reg.Split(otherParts[0], -1)
	var results [3]string
	results[0] = strings.SplitN(parts[0]," ",2)[0];
	results[1] = matches[0];
	results[2] = strings.Trim(name[0]," ");
	return results
}
