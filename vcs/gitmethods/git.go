package gitmethods

import (
	"io"
	"os/exec"
	"bytes"
	"strings"
	"regexp"
)
var filenameBlame map[string][]string = make(map[string][]string);

type GitBlame struct {
	Line uint
	GitBlame [3]string
}

type GitHistory struct {
	GitHistory [4]string
}


func CreateGitBlame(line [3]string, lineno uint) GitBlame{
	var obj GitBlame
	obj.Line = lineno
	obj.GitBlame = line;
	return obj;
}

func CreateGitHistory(lines [][4]string) []GitHistory{
	var res []GitHistory
	for _,value := range(lines){
		var obj GitHistory
		obj.GitHistory = value;
		res = append(res, obj);
	}
	return res;
}

func GitBlameAllLines(filename string, vcsdir string) [] string {
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

func GitBlameLines(start uint, filename string, vcsdir string ) [3]string{
	lines :=GitBlameAllLines(filename, vcsdir);

	if (start) > uint(len(lines)) {
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


func GitLogForFile(filename string, vcsdir string) [][4]string{

	cmd := exec.Command(
	"git" , "log", "-n5" ,"--format=%h%n%ad%n%an%n%f","--",filename)
	cmd.Dir = "data/"+vcsdir
	r, _ := cmd.StdoutPipe()
	defer r.Close()
	_ = cmd.Start()
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	resultgit,_ := strings.TrimSpace(buf.String()), cmd.Wait()

	var results [][4]string;
	var commit [4]string;
	for i,value := range strings.Split(resultgit, "\n") {
		commit[i%4] = value;
		if (i+1)%4 == 0 {
			results = append(results,commit);
			continue;
		}
	}

	return results;
}
